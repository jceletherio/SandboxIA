# Go 1.23+ — Padrões de Arquitetura

## Layout de projeto (standard Go project layout)

```
backend/go/
  cmd/
    <app>/
      main.go                    bootstrap: config, server, signals
  internal/
    <dominio>/
      handler.go                 http.HandlerFunc + roteamento (chunk por método)
      service.go                 lógica de domínio; recebe interfaces de store
      model.go                   tipos de domínio (Order, OrderItem)
      store.go                   interface OrderStore + impl PostgresStore
      dto.go                     CreateOrderRequest, OrderResponse (JSON tags)
      errors.go                  ErrConflict, ErrNotFound (sentinelas ou typed)
  pkg/                           (somente código reusável entre apps; raro em monorepo)
    httperr/
      httperr.go                 WriteError(w, status, code, msg)
    otel/
      middleware.go              traces HTTP, propagation OTel
  migrations/                    golang-migrate versioned
    0001_init.up.sql
    0001_init.down.sql
  go.mod
  go.sum
  Makefile (build, test, lint, migrate)
```

`internal/` impede import de fora do módulo. Cada domínio é pacote separado.

## Main — bootstrap

```go
package main

import (
  "context"
  "log/slog"
  "net/http"
  "os"
  "os/signal"
  "syscall"
  "time"

  "github.com/acme/shop/internal/orders"
  "github.com/acme/shop/pkg/pgxpool"
  "github.com/acme/shop/pkg/otel"
)

func main() {
  cfg := config.MustLoad()                  // valida env no boot
  logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
  slog.SetDefault(logger)

  pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
  if err != nil { slog.Error("pool", "err", err); os.Exit(1) }
  defer pool.Close()

  mux := http.NewServeMux()
  orders.Register(mux, orders.NewService(orders.NewPostgresStore(pool)))

  srv := &http.Server{ Addr: cfg.HTTPAddr, Handler: otel.Middleware(mux), ReadHeaderTimeout: 5 * time.Second }

  ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
  defer stop()

  go func() {
    _ = srv.ListenAndServe()
  }()
  slog.Info("listening", "addr", cfg.HTTPAddr)

  <-ctx.Done()
  shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
  defer cancel()
  if err := srv.Shutdown(shutdownCtx); err != nil { slog.Error("shutdown", "err", err) }
  slog.Info("bye")
}
```

## Handler — idiomatic

```go
package orders

import (
  "encoding/json"
  "net/http"
  "github.com/go-chi/chi/v5"
  "github.com/acme/shop/internal/auth"
  "github.com/acme/shop/pkg/httperr"
)

func Register(r chi.Router, svc *Service) {
  r.Route("/api/v1/orders", func(r chi.Router) {
    r.Use(auth.VerifyJWT)
    r.Post("/", create(svc))
    r.Get("/{id}", get(svc))
  })
}

func create(svc *Service) http.HandlerFunc {
  return func(w http.ResponseWriter, r *http.Request) {
    var req CreateOrderRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
      httperr.Write(w, http.StatusBadRequest, "bad_request", "payload inválido")
      return
    }
    if err := req.Validate(); err != nil {
      httperr.Write(w, http.StatusBadRequest, "bad_request", err.Error())
      return
    }
    tenantID := auth.TenantFrom(r.Context())
    order, err := svc.Create(r.Context(), req, tenantID)
    if err != nil {
      writeDomainError(w, err); return
    }
    w.Header().Set("Location", "/api/v1/orders/"+order.ID.String())
    httperr.WriteJSON(w, http.StatusCreated, toOrderResponse(order))
  }
}
```

- `http.HandlerFunc` factory (`func(svc) http.HandlerFunc`) — fecha dependências.
- `r.Context()` propagado ao service. `auth.TenantFrom(ctx)` lê claim injetada por
  middleware.
- `json.Decoder` streaming; limite body via `http.MaxBytesReader`.

## Service — context-first, errors typed

```go
package orders

import (
  "context"
  "errors"
  "time"
  "github.com/google/uuid"
)

var (
  ErrConflict  = errors.New("conflict: external_ref already exists")
  ErrNotFound  = errors.New("not found: order")
)

type Service struct {
  store OrderStore
  clock func() time.Time
}

func NewService(store OrderStore, opts ...Option) *Service {
  s := &Service{store: store, clock: time.Now}
  for _, o := range opts { o(s) }
  return s
}

func (s *Service) Create(ctx context.Context, req CreateOrderRequest, tenantID string) (Order, error) {
  order := Order{
    ID:          uuid.New(),
    ExternalRef: req.ExternalRef,
    Status:      StatusOpen,
    TenantID:    tenantID,
    CreatedAt:   s.clock(),
  }
  if err := s.store.Create(ctx, order); err != nil {
    if errors.Is(err, ErrConflict) { return Order{}, ErrConflict } // surface
    return Order{}, fmt.Errorf("create order: %w", err)
  }
  return order, nil
}
```

- `ctx` primeiro. Service não conhece HTTP (`w`/`r` não passa do handler).
- Erros sentinelas exportados; handler decide status via `errors.Is`.
- Erro não esperado → `%w` para preservar cadeia.

## Store — interface no consumer-side, pgxpool

```go
type OrderStore interface {
  Create(ctx context.Context, o Order) error
  FindByID(ctx context.Context, id uuid.UUID, tenantID string) (Order, error)
}

type PostgresStore struct {
  pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

func (s *PostgresStore) Create(ctx context.Context, o Order) error {
  _, err := s.pool.Exec(ctx,
    `INSERT INTO orders (id, external_ref, status, tenant_id, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, external_ref) DO NOTHING`,
    o.ID, o.ExternalRef, o.Status, o.TenantID, o.CreatedAt)
  if err != nil { return fmt.Errorf("insert order: %w", err) }
  return nil
}

func (s *PostgresStore) FindByID(ctx context.Context, id uuid.UUID, tenantID string) (Order, error) {
  row := s.pool.QueryRow(ctx,
    `SELECT id, external_ref, status, tenant_id, created_at
     FROM orders WHERE id = $1 AND tenant_id = $2`, id, tenantID)
  var o Order
  err := row.Scan(&o.ID, &o.ExternalRef, &o.Status, &o.TenantID, &o.CreatedAt)
  if errors.Is(err, pgx.ErrNoRows) { return Order{}, ErrNotFound }
  if err != nil { return Order{}, fmt.Errorf("find order: %w", err) }
  return o, nil
}
```

- `INSERT ... ON CONFLICT (tenant_id, external_ref) DO NOTHING` — idempotência para
  conflito. Verifique `commandTag.RowsAffected()` para distinguir insert/conflict.
- `pgx.ErrNoRows` mapeado para `ErrNotFound` (sentinela de domínio).
- Query sem placeholder `?` — Go postgresql uses `$1, $2`.

## Middleware

```go
type mw func(http.Handler) http.Handler

func chain(h http.Handler, mws ...mw) http.Handler {
  for i := len(mws) - 1; i >= 0; i-- { h = mws[i](h) }
  return h
}

func RecoverPanic(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    defer func() {
      if rec := recover(); rec != nil {
        slog.ErrorContext(r.Context(), "panic", "rec", rec, "stack", string(debug.Stack()))
        httperr.Write(w, http.StatusInternalServerError, "internal", "")
      }
    }()
    next.ServeHTTP(w, r)
  })
}
```

## Concorrência

```go
g, ctx := errgroup.WithContext(r.Context())
for _, item := range req.Items {
  g.Go(func() error {
    return svc.Reserve(ctx, item)
  })
}
if err := g.Wait(); err != nil { writeDomainError(w, err); return }
```

`errgroup` cancela ctx no primeiro erro — todas as goroutines param.

## Não faça

- `context.TODO()` dentro de handler — passe `r.Context()`.
- `time.Sleep` em handler/service sem `select` em `ctx.Done()`.
- `sync.Mutex` sem necessidade — Go 1.22+ `sync.Map` se leituras > escritas, senão
  `map` + `Mutex` explícito.
- `interface{}` (legado) — use `any` (alias desde 1.18).
- `http.Error(w, msg, code)` para corpo JSON — use `httperr.Write` com corpo estruturado.
- `fmt.Sprintf` em hot path de logging — use `slog.InfoContext(ctx, "msg", "key", val)`.