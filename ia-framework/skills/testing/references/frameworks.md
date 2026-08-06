# Frameworks por stack × nível — recipes

## Angular

### Unitário — Vitest (preferido em Angular 22; Jest legado)

Setup (instalado por `test-setup`):
```bash
cd frontend && ng add @angular/vitest-schematics || npm install --save-dev vitest @angular/build @vitest/coverage-v8 jsdom
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'jsdom', globals: true, setupFiles: ['src/test-setup.ts'] },
});
export { defineConfig as defineVitestConfig } from 'vitest/config';  // Angular schema hook
```

`src/test-setup.ts`:
```ts
import 'zone.js';  // required by Angular test bed
import { provideZonelessChangeDetection, provideExperimentalZonelessChangeDetection } from '@angular/core';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
```

Run: `npx vitest run` (CI) ou `npx vitest` (watch).

### Funcional — Testing Library Angular + TestBed

`npm install --save-dev @testing-library/angular`.

Verifica componente com `render(MyComp, { componentInputs: {...} })`. Usa `screen.getByRole`
para queries a11y. `httpResource` mock via `provideHttpClientTesting` + `HttpTestingController.expectOne(...)`.

### E2E/Aceitação — Playwright

Setup: `npm init playwright@static -- --save-dev -- brotli=false` em `frontend/e2e/`.
`playwright.config.ts` em `frontend/`.

```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4200',
         trace: 'on-first-retry', video: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'npm run dev', url: 'http://localhost:4200', reuseExistingServer: true, timeout: 60_000 },
});
```

## Node.js

### Unitário — Vitest (preferido) ou Jest

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', globals: true, coverage: { provider: 'v8', reporter: ['text'] } },
});
```

### Funcional — app.inject (Fastify) / supertest (Express)

Fastify: `await app.inject({ method: 'POST', url: '/api/v1/orders', payload: {...}, headers: {...} })`.
Express: `supertest(app).post('/api/v1/orders').send(...).set('Authorization', ...)`. Sem
BD real — fake do repo.

### Integração — Testcontainers (Postgres real)

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
const container = await new PostgreSqlContainer('postgres:16-alpine').start();
const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); await container.stop(); });
```

## Spring Boot

### Unitário — JUnit 5 + AssertJ + Mockito

```java
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {
  @Mock OrderRepository repo;
  @InjectMocks OrderService service;
  @Test void create_conflict() {
    when(repo.existsByExternalRefAndTenantId("dup", "t1")).thenReturn(true);
    assertThatThrownBy(() -> service.create(new CreateOrderDto("dup", "open", UUID.randomUUID()), "t1"))
        .isInstanceOf(ConflictException.class);
  }
}
```

### Funcional — `@WebMvcTest` + MockMvc

```java
@WebMvcTest(OrderController.class)
@Import({ GlobalExceptionHandler.class })
class OrderControllerTest {
  @Autowired MockMvc mvc;
  @MockBean OrderService service;
  @Test void post_invalid_returns_400() throws Exception {
    mvc.perform(post("/api/v1/orders").contentType(APPLICATION_JSON).content("{}"))
        .andExpect(status().isBadRequest());
  }
}
```

### Integração — `@SpringBootTest` + Testcontainers

```java
@SpringBootTest
@Testcontainers
class OrderIntegrationTest {
  @Container @ServiceConnection
  static PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16-alpine");
  @Autowired OrderRepository repo;
  @Test void insert_with_rls() { ... }
}
```

`pom.xml` deps: `org.testcontainers:junit-jupiter`, `org.testcontainers:postgresql`.

## Go

### Unitário — stdlib `testing` (table-driven)

```go
func TestCreate_Conflict(t *testing.T) {
  svc := NewService(fakeStore{conflict: true})
  cases := []struct{name string; in CreateOrderRequest; want error}{
    {"dup", CreateOrderRequest{ExternalRef: "dup"}, ErrConflict},
  }
  for _, c := range cases {
    t.Run(c.name, func(t *testing.T) {
      _, err := svc.Create(context.Background(), c.in, "t1")
      if !errors.Is(err, c.want) { t.Errorf("got %v want %v", err, c.want) }
    })
  }
}
```

### Funcional — `httptest` + handler + fake store

```go
handler := create(svc)
rec := httptest.NewRecorder()
req := httptest.NewRequest(http.MethodPost, "/api/v1/orders", strings.NewReader(`{...}`))
handler.ServeHTTP(rec, req)
if rec.Code != http.StatusCreated { t.Errorf(...) }
```

### Integração — `testcontainers-go`

```go
import tc "github.com/testcontainers/testcontainers-go"
import "github.com/testcontainers/testcontainers-go/modules/postgres"
pgContainer, err := postgres.Run(ctx, "postgres:16-alpine")
defer pgContainer.Terminate(ctx)
dsn, _ := pgContainer.ConnectionString(ctx, "sslmode=disable")
pool, _ := pgxpool.New(ctx, dsn)
```

## PostgreSQL (BD isolado)

### pgTAP

`BD/sql/tests/`:
```sql
BEGIN;
SELECT plan(2);
SELECT has_table('orders');
SELECT has_column('orders', 'external_ref');
SELECT finish();
ROLLBACK;
```

Runner: `pg_prove -d test_db BD/sql/tests/*.sql`.

### Testes de RLS

```sql
SET ROLE app_tenant;
SET LOCAL app.tenant_id = '<uuid-other>';
SELECT throws_ok(
  $$SELECT * FROM orders WHERE tenant_id = '<uuid-mine>'$$,
  'insufficient_privilege' /* ou 0 rows */
);
```

## Playwright cross-stack (UI + API)

Para testes E2E que cruzam: Playwright API request context permite chamar backend entre
passos de UI para setup/teardown. Ex.: criar pedido via API, validar na UI.

```ts
test('cria pedido e vê na lista', async ({ page, request }) => {
  // setup via API
  await request.post('/api/v1/customers', { data: {...} });
  // UI flow
  await page.goto('/orders/new');
  await page.fill('input[name="externalRef"]', 'PO-001');
  await page.click('button[type="submit"]');
  await expect(page.locator('text=PO-001')).toBeVisible();
});
```

## Atalhos

- **Angular Vitest config via `@angular/build:vite`** é o padrão em Angular 22. Use
  `ng test` se scheme setup; `npx vitest run` em setup manual.
- **Spring Testcontainers auto-config**: com `spring.testcontainers.version` no pom e
  `@ServiceConnection`, Spring Boot injeta datasource do container automaticamente.
- **Go**: `go test -tags integration ./...` ativa build-tags que carregam Testcontainers.
- **Postgres**: `pgTAP` é extensão — `CREATE EXTENSION IF NOT EXISTS pgtap;` antes.