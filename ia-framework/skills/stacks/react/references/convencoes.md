# React 19+ — Convenções

## Nomeação

- **Componentes**: `PascalCase.tsx` (`OrdersPage.tsx`, `OrderCard.tsx`). Arquivo = componente
  default export.
- **Hooks**: `usePascalCase` em `*.hooks.ts` ou junto ao componente.
- **Outros módulos**: `kebab-case.ts` (`orders.api.ts`, `orders.store.ts`).
- **Tipos**: `PascalCase` + sufixo (`OrderVm`, `OrderListParams`); types de props `Props`
  no topo do componente.
- **Booleanos**: prefixo `is/has/can/should` (`isPending`, `hasAccess`).
- Identificadores em inglês; comentários e mensagens em PT-BR.

## Imports

- Ordem: react → bibliotecas → `@/core` → `@/shared` → `@/features` → relativo.
- Alias `@/` → `src/` (vite.config `resolve.alias`).
- Sem import de lib inteira quando dá para importar o módulo (`lodash/` → função).
- Não importe de pastas de outra feature — extrair para `shared/`.

## Hooks

- Regras dos Hooks (ordem estável, sem condicionais antes do hook).
- `useEffect` só para efeito colateral sincronizado (foco, listener, analytics); não para
  derivar estado.
- Custom hook = `use*`; coeso, retorna o mínimo (`{ data, isPending, isError, refetch }`).

## Estado

- Local e descartável → `useState`/`useReducer` no componente.
- Cross-feature → Zustand com seletores curtos. Sem Redux sem decisão do arquiteto.
- Derivado puro → calcular no corpo/`useMemo`; nunca duplicar estado.

## Convenções de estilo (tokens)

- CSS com **design tokens** (`styles/tokens.css`: `--color-primary`, `--space-md`...), não
  hex solto. CSS Modules ou Tailwind conforme o projeto — um por feature, consistente.
- Sem `style={{...}}` inline para cor/space; exceção: layout dinâmico simples.
- Responsivo: breakpoints tokenizados; mobile-first.

## Comentários

- **Não adicionar** salvo solicitação. Convenção do projeto.
- **Sem emojis** — nunca em comentário de código.
- Se inevitável: PT-BR no corpo, ULTRA curto, justificando o porquê não o quê.

## Código limpo (regras gerais)

- **Nomes**: descritivos, sem abreviações; booleanos com prefixo `is/has/can/should`.
- **Componentes/funções**: curtos (≤ 25 linhas), uma responsabilidade; `early return`;
  aninhamento ≤ 2-3.
- **Tipos explícitos**: sem `any`; sem `var`; estados com tipos discriminados.
- **Sem código comentado** — delete em vez de comentar.
- **Sem magic number/string** — constante nomeada, enum ou token.
- **Sem `console.log`/`debugger`** — use logger/`console.error` apenas em handler de erro.
- **Sem `TODO`/`FIXME` órfãos** — resolve na task ou vira backlog no review.
- **Formatter/lint antes do commit** (prettier + eslint; `tsc --noEmit` limpo).
- **DRY por regra de três** — 3ª duplicação extrai; sem over-abstract antecipado (YAGNI).

## Testes

- Vitest + Testing Library + jest-dom. Nome: `*.test.ts(x)` ao lado do arquivo.
- Queries por `role`/`aria` (a11y-first), não por classe/testid (testid só para casos sem
  role semântico).
- Teste novo onde há lógica pura ou comportamento de componente (loading/erro/vazio);
  sem teste de template vazio nem e2e em trilha SDD.

## Commit

`shared/git-conventions.md`. Scope sugerido: `orders`, `auth`, `router`, `a11y`, `query`,
`zustand`, `i18n`.

## Hardlines do projeto-base

- `tsconfig` estrito (`strict: true`, `noUncheckedIndexedAccess`); sem `@ts-ignore`.
- `main.tsx`/`App.tsx`/provedores globais — não mexer sem tarefa explícita.
- Página com `React.lazy` — sem import eager de rota pesada.
