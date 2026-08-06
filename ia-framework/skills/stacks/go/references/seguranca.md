# Go 1.23+ — Segurança

## OWASP Top 10 por item

| Código | Item | Em Go |
| ------ | ---- | ----- |
| A01 | Broken Access | Middleware `auth.VerifyJWT` em rotas protegidas; `auth.TenantFrom(ctx)` lê claim; service sempre recebe `tenantID` e o inclui em toda query. |
| A02 | Crypto Fail | `golang.org/x/crypto/bcrypt` (cost 12+) ou `argon2id` via `golang.org/x/crypto/argon2`. **Nunca** MD5/SHA1. JWT RS256/ES256 via `github.com/golang-jwt/jwt/v5` ou authorizer externa (JWKS). |
| A03 | Injection | Queries via `pgx` parameterized (`$1, $2`); **nunca** `fmt.Sprintf` em SQL. Identifiers dinâmicos (ORDER BY) — whitelista de colunas. |
| A04 | Insecure Design | Threat modeling na fase 2 da spec. |
| A05 | Security Misconfig | `ReadHeaderTimeout` no `http.Server`, `MaxBytesReader` no body, desativar `Server` header via middleware, CORS allowlist via `rs/cors`. |
| A06 | Vuln Deps | `govulncheck ./...` em CI. Bot `dependabot`. Renovate. `go mod tidy` curated. |
| A07 | Auth Fail | JWT ≤ 15 min, refresh cookie HttpOnly Secure SameSite=Strict, lockout por tenant via store, rate-limit por tenant/IP via `golang.org/x/time/rate`. |
| A08 | Integrity Fail | Webhook: `crypto/hmac` SHA256 + constant-time `hmac.Equal`; replay protection via nonce no Redis/store com TTL. |
| A09 | Logging | `slog` JSON handler; correlation ID injetado por middleware via `context`. Nunca logar Authorization/password/PII. |
| A10 | SSRF | URL externa → allowlist de hosts; `net.DialContext` com `Resolver` restrito; `http.Client` com `CheckRedirect: func(...) http.ErrUseLastResponse`. |

## AuthN — JWT

```go
package auth

import (
  "context"
  "errors"
  "net/http"
  "strings"

  "github.com/golang-jwt/jwt/v5"
)

type ctxKey int
const tenantKey ctxKey = 1

func VerifyJWT(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    h := r.Header.Get("Authorization")
    if !strings.HasPrefix(h, "Bearer ") {
      WriteError(w, http.StatusUnauthorized, "unauthorized", "missing bearer")
      return
    }
    tok, err := jwt.Parse(strings.TrimPrefix(h, "Bearer "), keyFunc)
    if err != nil || !tok.Valid { WriteError(w, http.StatusUnauthorized, "unauthorized", "invalid"); return }
    claims, ok := tok.Claims.(jwt.MapClaims)
    if !ok { WriteError(w, http.StatusUnauthorized, "unauthorized", "claims"); return }
    if claims["tenant_id"] == nil { WriteError(w, http.StatusUnauthorized, "unauthorized", "tenant"); return }
    ctx := context.WithValue(r.Context(), tenantKey, claims["tenant_id"].(string))
    next.ServeHTTP(w, r.WithContext(ctx))
  })
}

func TenantFrom(ctx context.Context) string {
  if v, ok := ctx.Value(tenantKey).(string); ok { return v }
  return ""
}
```

- `keyFunc` busca JWK por `kid` no cache com refresh a 5 min.
- Rotação `kid`: JWKS publica dois `kid` na janela de sobreposição.

## Password hashing

```go
import "golang.org/x/crypto/bcrypt"

hash, _ := bcrypt.GenerateFromPassword([]byte(password), 12)
err := bcrypt.CompareHashAndPassword(hash, []byte(supplied))
```

Constante por design. Para argon2id (preferido em novos projetos):

```go
import "golang.org/x/crypto/argon2"
hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
```

## Rate-limit (token bucket por IP)

```go
import "golang.org/x/time/rate"

type limiter struct {
  mu  sync.Mutex
  ips map[string]*rate.Limiter
}

func (l *limiter) get(ip string) *rate.Limiter {
  l.mu.Lock(); defer l.mu.Unlock()
  if v, ok := l.ips[ip]; ok { return v }
  v := rate.NewLimiter(rate.Every(time.Minute/100), 10)
  l.ips[ip] = v; return v
}

func (l *limiter) Middleware(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    if !l.get(clientIP(r)).Allow() {
      w.Header().Set("Retry-After", "1")
      WriteError(w, http.StatusTooManyRequests, "rate_limited", "")
      return
    }
    next.ServeHTTP(w, r)
  })
}
```

Para multi-tenant distribuído: Redis-backed (`github.com/ulule/limiter/v3/drivers/redis`)
ou sidecar Envoy.

## CORS — allowlist não `*`

```go
import "github.com/rs/cors"

c := cors.New(cors.Options{
  AllowedOrigins:   cfg.CORSOrigins,
  AllowedMethods:   []string{"GET","POST","PUT","PATCH","DELETE"},
  AllowedHeaders:   []string{"Authorization","Content-Type","X-Requested-With"},
  AllowCredentials: true,
})
srv.Handler = c.Handler(mux)
```

## Body limits

```go
r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
dec := json.NewDecoder(r.Body)
dec.DisallowUnknownFields()
if err := dec.Decode(&req); err != nil { ... }
```

`DisallowUnknownFields` recusa campos extras — pensa bem: novo campo opcional vira
 breakingchange. Em contrato interno usar; em API pública pule.

## SQL injection — segurando a linha

```go
// errado
q := fmt.Sprintf("SELECT ... WHERE name = '%s'", name)        // NUNCA

// certo
rows, err := pool.Query(ctx, `SELECT ... WHERE name = $1`, name)
```

Identifiers dinâmicos:

```go
var allowedSort = map[string]string{
  "created_at": "created_at", "updated_at": "updated_at", "status": "status",
}
func sortCol(s string) string {
  if c, ok := allowedSort[s]; ok { return c }
  return "created_at"
}
q := fmt.Sprintf(`SELECT ... ORDER BY %s`, sortCol(req.Sort))
// justif: valor vem de whitelist fixa, não de input
```

## Webhook signature

```go
import (
  "crypto/hmac"
  "crypto/sha256"
  "encoding/hex"
)

func verify(rawBody []byte, sigHeader string, secret []byte) bool {
  mac := hmac.New(sha256.New, secret)
  mac.Write(rawBody)
  expected := hex.EncodeToString(mac.Sum(nil))
  return hmac.Equal([]byte(sigHeader), []byte(expected))
}
```

Replay protection: `nonce` no Redis `SETNX` com TTL 10 min. Timestamp no header
rejeita > 5 min de skew.

## Logging — slog estruturado

```go
slog.InfoContext(ctx, "order created", "id", order.ID, "tenant", tenantID)
slog.ErrorContext(ctx, "store error", "err", err)
```

- JSON handler em prod, text em dev.
- Nunca logar Authorization, password, token, PII.
- Filtro de redact (middleware): campos conhecidos -> `[REDACTED]`.

## Config segura

```go
type Config struct {
  HTTPAddr       string        `env:"HTTP_ADDR" default:":8080"`
  DatabaseURL    string        `env:"DATABASE_URL" validate:"required,url"`
  JWTJWKSURL     string        `env:"JWT_JWKS_URL" validate:"required,url"`
  CORSOrigins    []string      `env:"CORS_ORIGINS" envSeparator:","`
  LogFlushEvery  time.Duration `env:"LOG_FLUSH" default:"5s"`
}
```

Use `github.com/kelseyhightower/envconfig` ou `koanf`. Validation no boot. Missing em
prod → `slog.Error` + `os.Exit(1)` antes de ouvir porta.

## HTTP client seguro

```go
client := &http.Client{
  Timeout: 10 * time.Second,
  Transport: &http.Transport{
    DialContext: (&net.Dialer{ Timeout: 3 * time.Second }).DialContext,
    TLSHandshakeTimeout: 3 * time.Second,
    ResponseHeaderTimeout: 5 * time.Second,
  },
  CheckRedirect: func(req *http.Request, via []*http.Request) error {
    return http.ErrUseLastResponse // não segue redirects automáticos
  },
}
```

Para chamada a URL externa (SSRF risk): parsed = `url.Parse(input)`; allowlist de hosts
`net.LookupIP` antes de chamar.

## Não faça

- `crypto/rand` sem check de `err` (`n != len(buf)` obrigatório).
- `time.After` em loop sem select (`time.NewTimer` + `defer Stop()`).
- Goroutine sem quem aguarde — use WaitGroup/errgroup.
- `os.Getenv` dentro de handler — config carregada uma vez no boot.
- `encoding/csv` sem limit de fields/size — DoS.