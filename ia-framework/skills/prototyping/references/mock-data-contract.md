# Mock data estruturado para receber o backend definitivo

O protótipo usa dados mockados, mas **modelados por contrato**: as mesmas formas de DTO e o
mesmo seletor de dados que o backend definitivo exporá. Trocar mock por API real = trocar
**um provider**, nunca editar componentes.

## Princípio: interface (gateway) em vez de dados soltos

Nada de mock espalhado nos componentes. Toda consulta passa por uma **interface de API** que
espelha o contrato futuro:

```ts
// frontend/src/app/prototype/core/api/<domain>.gateway.ts
export interface OrderGateway {
  listOrders(params: OrderListParams): Promise<OrderPage>;
  getOrder(id: string): Promise<Order>;
  createOrder(input: OrderInput): Promise<Order>;
}
```

- O componente **só conhece a interface** e um token de injeção (`ORDER_GATEWAY`).
- O `MockOrderGateway` implementa a interface com fixtures + latência artificial.
- Quando o backend existir, um `HttpOrderGateway` (mesma interface, `HttpClient`/`fetch`)
  substitui o provider — componentes intactos.

## Formas de DTO espelham a API definitiva

- Nome dos campos, tipos e nullability idênticos ao contrato backend (trabalhe com
  `01-context/api-context.md` se existir).
- IDs **estáveis** (`uuid`/slug), nunca "1", "2" — permite link entre telas no protótipo.
- Datas em ISO 8601 (`2026-08-14T10:30:00Z`); valores monetários em `number` (centavos) ou
  com util de formatação — decida e padronize.
- Enums como union types (`'open' | 'paid' | 'shipped' | 'cancelled'`) — nenhuma string
  mágica solta.

## Fixtures

- Vivem em `frontend/src/app/prototype/core/api/fixtures/<domain>.ts`, 1 arquivo por domínio.
- Cada fixture cobre os 3 cenários do componente: **lista com dados**, **lista vazia**,
  **erro** (lançar/expor para o estado de erro).
- Dados plausíveis de negócio (nomes reais, valores coerentes) para validar layout real.
- **Sem regra de negócio** no fixture — só dados; nenhuma autorização/validação final.

## Latência e erro simulados

```ts
const DELAY = { ok: 350, empty: 600, error: 900 };

async function simulate(delay: number, errorRate = 0): Promise<void> {
  await new Promise((r) => setTimeout(r, delay));
  if (errorRate && Math.random() < errorRate) {
    throw new Error('Erro simulado: servidor indisponível');
  }
}
```

- Latência ~300-600ms para o skeleton ser perceptível (mas não irritante).
- Erro simulado (ou método `__failNext`) para exercitar o estado de erro manualmente.

## Seam de troca

```ts
// providers
providers: [
  { provide: ORDER_GATEWAY, useClass: MockOrderGateway },
  // { provide: ORDER_GATEWAY, useClass: HttpOrderGateway }, // quando backend existir
]
```

- Nunca `new MockOrderGateway()` dentro do componente.
- Para o backend definitivo, o `HttpOrderGateway` mapeia erros HTTP em erros tipados
  (ex.: `ApiError { status, code }`) que os estados de erro do componente já tratam.

## Regras duras

1. Componente depende da interface + token, **nunca** da classe mock.
2. DTOs centralizados em `core/api/` (compartilhados entre telas), não duplicados.
3. Mock nunca valida/autoriza — apenas retorna fixtures.
4. Estados loading/erro/vazio sempre exercitados nas fixtures.
5. O mock é "descartável": remover = apagar a pasta de mock + trocar provider.
