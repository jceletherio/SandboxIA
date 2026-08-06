# Playwright — guia de uso

## Por que Playwright

- Multi-browser (Chromium, Firefox, WebKit).
- Traces (`trace.zip`) — debugger post-mortem elegante; relevante em bug-fix.
- API request context — combina UI + API no mesmo teste.
- Auto-wait — não precisa `waitForTimeout` (código não deterministico).
- Retries e sharding first class.

## Setup (instalado por `test-setup`)

### Frontend Angular

`frontend/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4200',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

Run:
- Localheaded: `npx playwright test`
- Headless CI: `npx playwright test`
- UI mode: `npx playwright test --ui`
- Debug: `npx playwright test --debug`
- Trace viewer: `npx playwright show-trace trace.zip`

## Page Object Model (POM) — quando adotar

Adote quando os mesmos interações se repetem entre 3+ testes. Sem POM para 1-2 testes
(overkill).

```ts
// e2e/pages/orders-page.ts
import { Page, Locator } from '@playwright/test';
export class OrdersPage {
  constructor(private page: Page) {}
  newOrderButton(): Locator { return this.page.getByRole('button', { name: 'Novo pedido' }); }
  externalRefInput(): Locator { return this.page.getByLabel('Referência externa'); }
  async goto() { await this.page.goto('/orders'); }
  async createOrder(ref: string) {
    await this.newOrderButton().click();
    await this.externalRefInput().fill(ref);
    await this.page.getByRole('button', { name: 'Salvar' }).click();
  }
}

// e2e/orders-create.spec.ts
import { test, expect } from '@playwright/test';
import { OrdersPage } from './pages/orders-page';
test('cria pedido', async ({ page }) => {
  const ordersPage = new OrdersPage(page);
  await ordersPage.goto();
  await ordersPage.createOrder('PO-001');
  await expect(page.getByText('PO-001')).toBeVisible();
});
```

## Fixtures — para setup/teardown compartilhado

```ts
import { test as base, expect } from '@playwright/test';
import { OrdersPage } from './pages/orders-page';

type Fixtures = { ordersPage: OrdersPage; authedPage: Page };
export const test = base.extend<Fixtures>({
  ordersPage: async ({ page }, use) => { await use(new OrdersPage(page)); },
  authedPage: async ({ page, request }, use) => {
    // login via API, seta cookie/localStorage no page context
    const resp = await request.post('/api/v1/auth/login', { data: { email: 'qa@exemplo.com', password: 'test123' } });
    const { access_token, refresh_token } = (await resp.json());
    await page.context().addCookies([{ name: 'refresh_token', value: refresh_token, path: '/', httpOnly: true }]);
    await page.addInitScript(`window.__access_token = ${JSON.stringify(access_token)};`);
    await use(page);
  },
});
export { expect };
```

## API request context — para setup/teardown E2E cross-stack

Use antes de tocar a UI quando precisa criar registros de setup. Muito mais rápido que
 navegar por formulários até existir o dado.

```ts
test.beforeEach(async ({ request }) => {
  await request.post('/api/v1/test/reset', { data: { scope: tenant_id } });
});

test('lista pedidos cadastrados', async ({ page, request }) => {
  await request.post('/api/v1/orders', { data: { externalRef: 'A-1' } });
  await page.goto('/orders');
  await expect(page.getByText('A-1')).toBeVisible();
});
```

## Auto-wait e boas práticas

- **Não** `page.waitForTimeout(500)` — non-deterministic. Use `await expect(loc).toBeVisible()`.
- Sempre que possível, use `getByRole`, `getByLabel`, `getByText` — resistentes a mudança de CSS,
  promove a11y.
- Evite selectors CSS (`#foo > .bar > a`) — quebram com refactor de layout.
- `await page.click(selector)` espera pelo visibility automaticamente.

## Traces em bug-fix

Em `regression-author`, colete trace no teste red:

```ts
test('regressão: checkout com carrinho vazio não vira 200', async ({ page }, testInfo) => {
  // capturando trace helper para post-mortem
  await page.goto('/cart');
  await page.getByRole('button', { name: 'Finalizar' }).click();
  // esperamos bug: mostra 200 mas deveria mostrar erro
  await testInfo.attach('screenshot-cart-empty', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(page.getByText('Carrinho vazio')).toBeVisible();
});
```

Após `npx playwright test --trace on`, abra o trace com `npx playwright show-trace
test-results/.../trace.zip`.

## CI

- Cache `~/.cache/ms-playwright` (Linux/macOS) ou `%USERPROFILE%\AppData\Local\ms-playwright` (Windows).
- Install: `npx playwright install --with-deps chromium webkit`.
- Headless em CI: `npx playwright test --reporter=github`.
- Sharding: `--shard=1/3` em matrix CI.

## Não faça

- Não rode Playwright em modo CI sem `--reporter=github`/`junit` — output unreadable em logs.
- Não hardcode `localhost:4200` no test — use `baseURL` do config + `process.env.E2E_BASE_URL`.
- Não persista `storageState` com tokens JWT longa vida em repo — secret leak.