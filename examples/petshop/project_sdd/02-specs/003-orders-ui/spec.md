**Variante:** feature
**Stack:** angular
**Slug:** orders-ui

## Comportamento alvo

- [x] Tela `S-001` implementada em `src/frontend/src/app/orders/orders.component.ts` standalone,
  signals, `@if/@for`.
- [x] Estado loading (skeleton), erro (retry), vazio (CTA "Fazer primeiro pedido").
- [x] `httpResource<OrdersPage>('/api/v1/orders')` com `parse` schema guard.
- [x] Filtros por status atualiza `httpResource` via `computed` query.
- [x] `track item.id` em `@for` (sem `track` → lint error).
- [x] Acessível: `role="table"`, `scope="col"`, botões icon-only com `aria-label`.

## Contratos tocados

```ts
interface OrdersPage {
  items: OrderVm[];
  nextCursor: string | null;
}
interface OrderVm {
  id: string; externalRef: string; status: 'open'|'paid'|'shipped'|'cancelled';
  total: number; createdAt: string;
}

// orders.component.ts
readonly ordersResource = httpResource<OrdersPage>(
  () => `/api/v1/orders?status=${this.filter().status}`,
  { parse: (r) => schemaGuard('OrdersPage', r) }
);
readonly vm = computed(() => ({
  items: this.ordersResource.value()?.items ?? [],
  loading: this.ordersResource.isLoading(),
  error: this.ordersResource.error() ?? null,
}));
```

Ref.: `01-context/screens/S-001-orders-list.md` (UI/layout, componentes, paths, estados, a11y).

## Tarefas

1. [ ] angular: criar `src/frontend/src/app/orders/orders.component.ts` standalone + signals.
2. [ ] angular: `orders.routes.ts` com `loadComponent` lazy + `canMatch isAuthenticated`.
3. [ ] angular: template `@if/@for` com estado loading/erro/vazio (ver tela S-001).
4. [ ] angular: `app-orders-table`, `app-order-filter-panel`, `app-skeleton`,
   `app-empty-state`, `app-error-state` em `shared/ui/` (全会 components standalone).
5. [ ] angular: `httpResource` com `parse` schema guard.
6. [ ] angular: vitest unitário para `filter` `computed` (puro).
7. [ ] angular: Playwright e2e em `src/frontend/e2e/orders.spec.ts` com 3 cenários (lista,
   loading, vazio) — gerado por `/tests-release --stack=angular`.

## Fora de escopo

- Detalhe do pedido (`/orders/<id>`) — trilha `007` (a abrir).
- Backend `/api/v1/orders` — trilha `004` concluída.

## Premissas assumidas

- Premissa: backend `/api/v1/orders` retorna `200 OrdersPage` (trilha `004` validada).

## Notas de review

verdict: ready — Vitest + Playwright passing; a11y axe-core sem finding critical.