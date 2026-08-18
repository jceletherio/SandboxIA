# React — Testing

## Stack

- **React 19+** function components + hooks, Vite + TypeScript, TanStack Query, Zustand.
- **Regras fortes** (ver SKILL.md): sem class components, sem `any`, sem
  `dangerouslySetInnerHTML` sem sanitize; queries por `role`/`aria`.

## Níveis × Frameworks

| Nível | Framework | Notas |
| ----- | --------- | ----- |
| Unitário | Vitest | `environment: 'jsdom'`. Testa utils, reducers, mappers, hooks puros. |
| Funcional | Testing Library React (`@testing-library/react`) + jest-dom | Renderiza componente; Query mockado via `QueryClient` custom. |
| Integração | Testing Library + providers reais (QueryClient, Router) | Quando a feature usa store/rotas reais com `api/` mockado. |
| Aceitação/E2E | Playwright (testDir `src/react/e2e/`) | User journeys, baseURL `http://localhost:5173` (Vite). |

## Setup

`test-setup` instalará:
- `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`
- `@tanstack/react-query` (já de runtime), `@playwright/test` em `src/react/e2e/`

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'jsdom', globals: true, setupFiles: ['src/test-setup.ts'] },
  resolve: { alias: { '@': '/src' } },
});
```

`src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

## Unitário — boilerplate

```ts
import { describe, it, expect } from 'vitest';
import { formatTotal } from '@/shared/lib/format';

describe('formatTotal', () => {
  it('formata centavos para reais', () => {
    expect(formatTotal(12500)).toBe('R$ 125,00');
  });
});
```

## Funcional — Testing Library + QueryClient

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrdersView } from './orders.view';

const queryClient = new QueryClient();

test('mostra skeleton durante loading', () => {
  render(<OrdersView vm={{ items: [], loading: true, error: null }} onRetry={() => {}} />);
  expect(screen.getByTestId('orders-skeleton')).toBeInTheDocument();
});

test('mostra erro com retry', () => {
  render(<OrdersView vm={{ items: [], loading: false, error: new Error('rede') }} onRetry={() => {}} />);
  expect(screen.getByText(/erro ao carregar/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
});

test('mostra empty state quando sem dados', () => {
  render(<OrdersView vm={{ items: [], loading: false, error: null }} onRetry={() => {}} />);
  expect(screen.getByRole('button', { name: /novo pedido/i })).toBeInTheDocument();
});
```

Para página que conecta Query: `QueryClient` custom com `retry: false` e resposta mockada
na `queryFn` (mock do módulo `api/` via `vi.mock`).

## E2E/Aceitação — Playwright

Pasta `src/react/e2e/`. Cenários derivam dos bullets de "Comportamento alvo" da spec.
`playwright.config.ts` com `webServer: { command: 'npm run dev -- --port 5173', url: 'http://localhost:5173' }`.

## Bug-fix regressão

- Lógica pura → unitário.
- Transições de estado (loading/erro/vazio) → funcional.
- Fluxo cross-stack com backend → E2E com Playwright API context para setup.

Artefato: `trace.zip` em `test-results/<nome-teste>/`; reprodução do red via
`testInfo.attach()` antes do fix.

## Não faça

- Não use `fireEvent` quando `user-event` reproduz o comportamento real (foco, blur).
- Não use `act` manualmente em testes novos — RTL/`user-event` já envolvem.
- Não crie e2e ao lado do componente — E2E vive em `e2e/`.
- Não escreva teste de template sem asserção de comportamento (evita teste "de decoração").
