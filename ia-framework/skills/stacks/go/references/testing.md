# Go — Testing

## Stack atual

- **Go 1.23+** (modules). pgxpool. context-first. `errors.Is/%w`.

## Níveis × Frameworks

| Nível | Framework | Notas |
| ----- | --------- | ----- |
| Unitário | stdlib `testing` table-driven | Lógica pura: validators, mappers, service com fake store. |
| Funcional | `httptest` + handler + fake store | Handler recebe `httptest.NewRequest`; assert status/body. |
| Integração | `testcontainers-go` Postgres + `httptest` | Run migrations; store real; valida tx, FK, `pgx.ErrNoRows`, `ON CONFLICT`. |
| Sistema | `httptest.NewServer` + real binary via `cmd/server` | `go run ./cmd/server` em background; smoke `/health`. |
| Aceitação | Playwright API request context | Cenários da spec viram HTTP calls. |
| E2E | Playwright (se frontend) | Combina UI+API. |

## Setup do projeto

`test-setup` criará ou adicionará ao `Makefile`:
```make
.PHONY: test test-unit test-integration vet

test: test-unit test-integration
test-unit:
	go test -short ./...
test-integration:
	go test -tags=integration ./...
vet:
	go vet ./...
```

Adicionará:
- `github.com/testcontainers/testcontainers-go`
- `github.com/testcontainers/testcontainers-go/modules/postgres`
- `github.com/stretchr/testify/require` (opcional — preferido `errors.Is` em assertions)

`go.mod` já vem por `go mod init`.

## Unitário — table-driven idiomático

```go
func TestCreateOrderRequest_Validate(t *testing.T) {
  cases := []struct{name string; in CreateOrderRequest; wantErr bool}{
    {"empty external ref", CreateOrderRequest{ExternalRef: ""}, true},
    {"valid", CreateOrderRequest{ExternalRef: "PO-1", Status: "open"}, false},
  }
  for _, c := range cases {
    t.Run(c.name, func(t *testing.T) {
      err := c.in.Validate()
      if c.wantErr && err == nil { t.Errorf("esperava error, got nil") }
      if !c.wantErr && err != nil { t.Errorf("não esperava error, got %v", err) }
    })
  }
}
```

## Funcional — `httptest`

```go
func TestCreateOrder_Handler(t *testing.T) {
  svc := NewService(fakeStore{})
  h := create(svc)

  rec := httptest.NewRecorder()
  req := httptest.NewRequest(http.MethodPost, "/api/v1/orders",
    strings.NewReader(`{"externalRef":"PO-1","status":"open"}`))
  req.Header.Set("Authorization", "Bearer mock-jwt")

  h.ServeHTTP(rec, req)

  if rec.Code != http.StatusCreated {
    t.Errorf("status: got %d want %d", rec.Code, http.StatusCreated)
  }
  var body OrderResponse
  if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil { t.Fatal(err) }
  if body.ExternalRef != "PO-1" { t.Errorf("body: %v", body) }
}
```

## Integração — Testcontainers-go

```go
//go:build integration

package orders_test

import (
  "context"
  "testing"
  "github.com/testcontainers/testcontainers-go/modules/postgres"
  "github.com/jackc/pgx/v5/pgxpool"
)

func TestStore_Create_OnConflict(t *testing.T) {
  ctx := context.Background()
  pgC, _ := postgres.Run(ctx, "postgres:16-alpine")
  t.Cleanup(func() { _ = pgC.Terminate(ctx) })
  dsn, _ := pgC.ConnectionString(ctx, "sslmode=disable")
  pool, _ := pgxpool.New(ctx, dsn)
  runMigrations(ctx, pool)

  store := NewPostgresStore(pool)

  if err := store.Create(ctx, Order{ID: uuid.New(), ExternalRef: "PO-DUP", TenantID: "t1"}); err != nil {
    t.Fatal(err)
  }
  err := store.Create(ctx, Order{ID: uuid.New(), ExternalRef: "PO-DUP", TenantID: "t1"})
  if !errors.Is(err, ErrConflict) {
    t.Errorf("got %v want ErrConflict", err)
  }
}
```

## Bug-fix regressão

Reproduz no nível certo:
- service.go logic → unit (`test_customer_create.go`).
- handler HTTP behavior (status code shape) → funcional (`httptest`).
- store.go + SQL (tx, conflict, RLS filter) → integration (`testcontainers-go`).

Após fix:
- `go test ./internal/<dominio>/...` deve passar green.
- Commit do teste + fix no mesmo `git commit` (em trilha bugfix).

Use `t.Skip("requires reprodução manual")` quando realmente não for reproduzível por teste
 (UI behavior fora browser); documente em `Lacunas`.

## Não faça

- Não use `time.Sleep` para esperar assincronia — `require.Eventually` ou channel de
  pronta. Em stores, queries são síncronas (sem sleep).
- Não escreva `if err != nil { t.Fatal(err) }` sem log de contexto; use
  `t.Fatalf("create order: %v", err)` — facilita debug.
- Não crie `main_test.go` em `internal/` para testes de integração — prefira build tag
  `//go:build integration` no próprio arquivo para separar suítes (build tag, não run flag).
- Não `defer rows.Close()` em test тільки quando chamou `pool.Query`; se `QueryRow`, não há
  rows para fechar.