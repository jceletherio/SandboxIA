---
name: react
description: Conduz o fluxo SDD Enxuto para React 19+ (frontend SPA) — Vite + TypeScript, function components + hooks, TanStack Query (server state), Zustand (client state), React Router (lazy + loaders), CSS Modules/design tokens, Vitest + Testing Library, Playwright e2e, a11y. Gatilhos: "feature React", "tela React", "componente React", "hooks", "TanStack Query", "/sdd react".
---

# React 19+ — fluxo SDD Enxuto

Especificar antes do código, no mínimo de cerimônia que ainda evita retrabalho. As 5 fases
gerais estão em `skills/shared/flow.md`; os detalhes específicos de React, aqui e em
`references/`.

| Fase | Produz | Fecha quando |
| ---- | ------ | ------------ |
| 1. Contexto | mapa de componentes/rotas/services/estado afetados | você sabe onde mexer na árvore React |
| 2. Spec + Tarefas | `02-specs/{NNN}-{slug}/spec.md` | tarefas executáveis, contratos de component/hook definidos |
| 3. Implementação | código function components + hooks + TS estrito | `tsc --noEmit` e a suíte existente passam |
| 4. Review + Testes | `verdict: ready \| blocked` com `arquivo:linha` | comportamento alvo bate com o código |
| 5. Report | decisões não óbvias + achados fora de escopo | próxima sessão retoma sem ler o diff |

## Princípios React

1. **Function components + hooks.** Sem class components. `useState`, `useReducer`,
   `useEffect`, `useMemo`, `useCallback`, `useContext`, `useRef`, custom hooks (`use*`).
2. **TypeScript estrito.** Sem `any` — `unknown` + narrow ou tipos discriminados. Tipos de
   props/state explícitos. Sem `PropTypes` (TS substitui).
3. **Server state via TanStack Query (v5).** `useQuery`/`useMutation` para dados remotos
   (cache, refetch, loading/erro). `HttpClient`/`fetch` encapsulado em `api/*` module.
4. **Client state mínimo.** `useState`/`useReducer` locais; **Zustand** (store pequeno) só
   para estado cross-feature (auth, perfil). Sem Redux sem justificativa.
5. **React Router v7.** Rotas com lazy (`React.lazy` + `Suspense`), loaders/actions para
   data fetching por rota quando fizer sentido. Guards de rota via componente wrapper.
6. **Estados loading/erro/vazio em toda visualização** — Query `isPending`/`isError`/`data`
   mapeados para skeleton/erro/vazio.
7. **A11y de primeira classe.** Testing Library por `role`/`aria`; foco gerenciado em
   modais; contraste AA; `aria-*` em controles custom; navegação por teclado.
8. **Código dividido** — `React.lazy` por rota; bundle menor; sem import gigante de lib.
9. **StrictMode em dev** (`main.tsx`). Zoneless/não há equivalente Angular aqui — re-render
   via estado, não via `forceUpdate`.
10. **Sem regra de negócio canônica no frontend** — validação/autorização final é do backend.

## Setup (na primeira vez do projeto)

1. `SDD_ROOT` (default `./project_sdd`). Árvore inexistente →
   `pwsh skills/scaffold.ps1 init <SDD_ROOT>` (ou `bash skills/scaffold.sh init`).
2. App: `/setup-tooling --apps` cria o skeleton Vite + React + TS em `src/react/`
   (`npm create vite@latest` com template react-ts).
3. Trilha nova: `pwsh skills/scaffold.ps1 new feature <slug>`.

## As 5 fases (específicas React)

**1. Contexto.** Identifique componentes, hooks, queries (TanStack), stores (Zustand),
rotas, guard wrapper e tokens de design afetados. Ambiguidades em bloco: quem possui o
estado? query client ou local? lazy ou eager? qual token?

**2. Spec + Tarefas.** Contratos de component (props `type Props = {...}`), hooks custom
(`useOrders(...)`), queries (chave + queryFn + transform). Erros vêm de onde? Estados
loading/erro/vazio explícitos em cada bullet. Tarefas por feature folder
(`src/react/src/features/<feature>/`).

**3. Implementação.** Padrões em `references/arquitetura.md`. Um commit por task
(`shared/git-conventions.md`). Não rode `npm run dev` se já estiver de pé — só `tsc
--noEmit`/`npm run lint` quando o review exigir. Sem `any` — `unknown` + narrow.

**4. Review + Testes.** Delegue ao `reviewer`. Suíte Vitest + Testing Library. Teste novo
só para lógica pura e componentes com estado (loading/erro/vazio). E2E Playwright é outra
trilha (`/tests-release`).

**5. Report.** Decisão de arquitetura React (Query vs SWR, Zustand vs Context, lazy routes),
armadilhas de `useEffect`, a11y pendente.

## Regras duras

- **Nunca** class component, `dangerouslySetInnerHTML` sem sanitização (DOMPurify), `any`,
  `PropTypes`, `console.log` de debug no commit.
- **Nunca** mutar estado React fora de setState/store — componentes são função do estado.
- **Sem** Redux novo sem decisão de arquiteto; **sem** `useEffect` para derivar estado —
  use `useMemo`/derivado direto ou Query.
- **Sem hardcode hex/CSS inline** — tokens de design (`bg-card`, `text-foreground`...).
- **Sem** chamadas `fetch` soltas no componente — sempre pelo módulo `api/` + Query.
- **Não mexa** em `main.tsx`/provedores globais sem ser tarefa explícita.

## Limitação (declare no recibo)

Você não tem navegador: review de visual e interação é **estático** (JSX, a11y no markup,
lazy/SSR no código). Item visual/UX → marque `requires_human_validation`.
