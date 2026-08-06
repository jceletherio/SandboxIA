import { test, expect } from '@playwright/test';

test('cria pedido e vê na lista', async ({ page, request }) => {
  // setup via API quando aplicável
  // await request.post('/api/v1/seed', { data: { ... } });

  await page.goto('/orders/new');
  await page.getByLabel('Referência externa').fill('PO-E2E-001');
  await page.getByRole('button', { name: 'Salvar' }).click();

  await page.goto('/orders');
  await expect(page.getByText('PO-E2E-001')).toBeVisible();
});

test('não permite checkout com carrinho vazio', async ({ page }) => {
  await page.goto('/cart');
  // força estado vazio
  await page.getByRole('button', { name: 'Finalizar' }).click();
  await expect(page.getByText(/carrinho vazio/i)).toBeVisible();
});