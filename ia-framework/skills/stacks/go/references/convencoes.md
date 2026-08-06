# Go 1.23+ — Convenções

## Nomeação

- **Pacote**: short, lowercase, sem `_` (`orders`, `authhttp`, `pgstore`). Singular quando
  faz sentido (`orders` para domínio, `httperr` para util).
- **Export**: `CamelCase` (exportado), `camelCase` (pacote-interno). Sem `_` em nomes.
- **Interface**: nome do papel — `OrderStore`, `JWTVerifier`, `Clock`. Methods `Create`,
  `FindByID` (verbos). Consumer-side declaration.
- **Type**: `Order`, `OrderItem`, `CreateOrderRequest`, `OrderResponse`.
- **Constants**: `CamelCase` (Go não usa `ALL_CAPS`).
- **Errors**: `var ErrConflict = errors.New(...)` ou `type ConflictError struct{...}`
  + `Error()`/`Is()`.

## Imports

Três blocos separados (goimports/go-reviser):

```go
import (
  "context"
  "errors"
  "time"

  "github.com/google/uuid"
  "github.com/jackc/pgx/v5/pgxpool"

  "github.com/acme/shop/internal/orders"
  "github.com/acme/shop/pkg/httperr"
)
```

## Receivers

- Pointer receiver para métodos que mutam state ou struct grande:
  ```go
  func (s *Service) Create(ctx, ...) (Order, error) {}
  ```
- Value receiver para tipos pequenos imutáveis (`type ID uuid.UUID`).
- **Nunca** misture pointer/value receivers no mesmo tipo.

## Erros — disciplina

- Wrapping: `fmt.Errorf("create order: %w", err)`.
- Branching: `errors.Is(err, ErrConflict)`, `errors.As(err, &target)`.
- Não criptografar mensagem: se erro é para usuário, criado no domínio com mensagem fixa.
- Erro de infra (BD, rede) → wrap e devolver interno (`http.StatusInternalServerError`).
- Não retorne `err.Error()` como mensagem ao cliente — use `code` no corpo JSON.

## HTTP — escrita de resposta

```go
package httperr

import "encoding/json"

func WriteJSON(w http.ResponseWriter, status int, body any) {
  w.Header().Set("Content-Type", "application/json; charset=utf-8")
  w.WriteHeader(status)
  _ = json.NewEncoder(w).Encode(body)
}

func Write(w http.ResponseWriter, status int, code, message string) {
  WriteJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message}})
}
```

Sem `http.Error` (text/plain) — corpo JSON é contrato.

## Context e deadlines

- `ctx` primeiro parâmetro: `func (s *Service) Find(ctx context.Context, id ID) (Order, error)`.
- Em query BD: `s.pool.QueryRow(ctx, ...)`. pgx respeita ctx.
- Para timeout de service específico: `ctx, cancel := context.WithTimeout(ctx, 2*time.Second); defer cancel()`.
- **Nunca** `context.Background()` dentro de handler — pegue `r.Context()`.

## Testes

- Table-driven é idiomático:
  ```go
  func TestCreate(t *testing.T) {
    cases := []struct{ name string; in Order; want error }{
      {"ok", Order{...}, nil},
      {"conflict", Order{ExternalRef: "dup"}, ErrConflict},
    }
    for _, c := range cases {
      t.Run(c.name, func(t *testing.T) {
        _, err := svc.Create(ctx, c.in, tenant)
        if !errors.Is(err, c.want) { t.Errorf("got %v want %v", err, c.want) }
      })
    }
  }
  ```
- Use `testify/require` ou `errors.Is` no assertion.
- Integration: `testcontainers-go` Postgres real (`github.com/testcontainers/testcontainers-go`).
- Mocks: gerados (`mockgen`/`counterfeiter`) ou implementação fake em memória — preferido
  fake (mais simples, mais rápido, mais type-safe).
- Nome de arquivo: `service_test.go`, `store_integration_test.go` (build tag `//go:build integration`).

## Logging

- `slog` (stdlib desde 1.21). JSON handler em prod.
- Nível INFO default. DEBUG só com flag.
- `slog.With("tenant_id", tenantID)` para bindings que reaparecem.

## Build / Makefile

```make
.PHONY: build test lint run migrate-up

build:
	go build ./...
test:
	go test ./...
lint:
	golangci-lint run
vuln:
	govulncheck ./...
migrate-up:
	migrate -path migrations -database $$DATABASE_URL up
```

## Commit

`shared/git-conventions.md`. Scopes: `handler`, `service`, `repo`, `middleware`, `px`,
`server`. Exemplo:

```
feat(orders): adiciona handler POST /orders com ctx propagation e ErrConflict mapping
```

## Hardlines

- Não rode `go run ./cmd/<app>` em sessão SDD — servidor vivo é operação do usuário.
- Não `go get` nova dependência sem ser tarefa explícita (decisão arquitetural).
- Não commit `vendor/` se projeto usa módulos (padrão). `.env*` em `.gitignore`.
- Não pule `defer rows.Close()` — `sqlclosecheck` linter bloqueia.