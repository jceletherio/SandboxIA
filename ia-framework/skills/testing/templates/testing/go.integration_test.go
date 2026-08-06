//go:build integration

package orders_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/acme/shop/internal/orders"
	tcp "github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCreateOrder_Endpoint(t *testing.T) {
	if testing.Short() { t.Skip("skipping integration in short mode") }
	ctx := context.Background()
	pgC, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("test"), postgres.WithUsername("u"), postgres.WithPassword("p"))
	if err != nil { t.Fatalf("container: %v", err) }
	t.Cleanup(func() { _ = pgC.Terminate(ctx) })

	dsn, _ := pgC.ConnectionString(ctx, "sslmode=disable")
	pool, _ := pgxpool.New(ctx, dsn)
	_ = runMigrations(ctx, pool) // helper applying V*.sql from BD/sql/migrations

	store := orders.NewPostgresStore(pool)
	svc := orders.NewService(store)
	mux := http.NewServeMux()
	orders.Register(mux, svc)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	res, err := http.Post(srv.URL+"/api/v1/orders", "application/json",
		strings.NewReader(`{"externalRef":"PO-1","status":"open"}`))
	if err != nil { t.Fatal(err) }
	if res.StatusCode != http.StatusCreated {
		t.Errorf("got %d want %d", res.StatusCode, http.StatusCreated)
	}
}

var _ = tcp.ContainerRequest{} // evita unused quando tcp abstraída