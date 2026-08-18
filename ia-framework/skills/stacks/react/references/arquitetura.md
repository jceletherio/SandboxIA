# React 19+ — Padrões de Arquitetura

## Estrutura de pastas — feature folders

```
src/react/
  src/
    <feature>/
      <feature>.tsx               página/container (conecta Query/Zustand)
      components/                 componentes locais da feature (PascalCase.tsx)
      <feature>.hooks.ts          custom hooks (useOrders, useOrderFilters)
      <feature>.store.ts          Zustand store (se estado cross-feature)
      models.ts                   tipos do domínio da feature
    core/
      api/                        client HTTP + funções por recurso (listOrders, getOrder)
      auth/                       token em memória, guard wrapper RequireAuth
      router/                     rotas (lazy + Suspense), loaders
      layout/                     shell, header, sidebar
    shared/
      ui/                         botão, card, dialog (reusable, tokens)
      hooks/                      hooks genéricos (useDebounce, useMediaQuery)
      lib/                        utils puros, formatters
    styles/                       design tokens (CSS variables), global.css
    main.tsx                      createRoot + QueryClientProvider + RouterProvider
    App.tsx                       rotas raiz
  vitest.config.ts
  vite.config.ts
```

## Provedores de bootstrap (`main.tsx`)

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

## Componente — página (container fino)

```tsx
type OrdersVm = { items: Order[]; loading: boolean; error: Error | null };

export function OrdersPage() {
  const { data, isPending, isError, error } = useOrders({ status: 'open' });
  const vm: OrdersVm = {
    items: data?.items ?? [],
    loading: isPending,
    error: isError ? error : null,
  };
  return <OrdersView vm={vm} onRetry={() => queryClient.invalidateQueries({ queryKey: ['orders'] })} />;
}
```

- Página conecta dados/estado; **view** recebe props (fácil de testar e reusar).
- `useMemo` para derivados pesados; derivado barato é direto no corpo.

## Server state — TanStack Query

```ts
// core/api/orders.ts
export async function listOrders(params: OrderListParams): Promise<OrderPage> {
  const res = await api.get(`/api/v1/orders`, { params });
  if (!res.ok) throw new ApiError(res.status, await res.json());
  return schemaGuard('OrderPage', await res.json());
}

// <feature>/orders.hooks.ts
export function useOrders(params: OrderListParams) {
  return useQuery({ queryKey: ['orders', params], queryFn: () => listOrders(params) });
}
export function useCreateOrder() {
  return useMutation({ mutationFn: createOrder, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }) });
}
```

- Chave estável e serializável; `staleTime` por recurso; mutação invalida listas afetadas.
- Erros tipados (`ApiError`) para o estado de erro da view.

## Client state — Zustand (só cross-feature)

```ts
// core/auth/auth.store.ts
type AuthState = { token: string | null; setToken: (t: string | null) => void };
export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  setToken: (token) => set({ token }),
}));
```

- Seletores curtos: `const token = useAuthStore((s) => s.token)` — evita re-render em excesso.
- Estado local e descartável → `useState`/`useReducer`, não store.

## Rotas — lazy + guard wrapper

```tsx
import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';

const OrdersPage = lazy(() => import('@/features/orders/orders.page').then((m) => ({ default: m.OrdersPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export const router = createBrowserRouter([
  {
    path: '/orders',
    element: <RequireAuth><Suspense fallback={<PageSkeleton />}><OrdersPage /></Suspense></RequireAuth>,
  },
  { path: '/login', element: <LoginPage /> },
]);
```

- `React.lazy` + `Suspense` por rota; guard wrapper em vez de interceptor de rota.
- Loaders (`loader`) só quando a rota tem contrato de dados próprio e imutável.

## Estado de loading/erro/vazio — sempre três

```tsx
export function OrdersView({ vm, onRetry }: OrdersViewProps) {
  if (vm.loading) return <SkeletonList />;
  if (vm.error)   return <ErrorState error={vm.error} onRetry={onRetry} />;
  if (vm.items.length === 0) return <EmptyState actionLabel="Novo pedido" />;
  return <OrderList items={vm.items} />;
}
```

## A11y

- Testing Library queries por `role`/`name`; `aria-label` em botões icon-only.
- Foco gerenciado em modal (`useEffect` + `useRef` + `focus trap`), `role="dialog"`,
  `aria-modal`, Esc fecha.
- Contraste AA; nada só por cor (ícone+texto); labels visíveis ou `aria-label`.

## Não faça

- `dangerouslySetInnerHTML` sem `DOMPurify.sanitize` — XSS.
- Chamar `fetch` direto no componente — módulo `api/` + Query.
- `useEffect` para derivar estado derivável — `useMemo`/cálculo direto.
- Mutar props/state diretamente; componente é função do estado.
- Regra de negócio canônica no frontend — autorização/validação final é server-side.
