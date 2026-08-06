---
name: angular
description: Conduz o fluxo SDD Enxuto para Angular 22 — standalone, signals, novo control flow `@if/@for/@switch`, zoneless, httpResource/resource, lazy routes, hydration. Gatilhos: "feature Angular", "tela Angular", "rotas Angular", "signals", "httpResource", "/sdd angular".
---

# Angular 22 — fluxo SDD Enxuto

Especificar antes do código, no mínimo de cerimônia que ainda evita retrabalho. As 5 fases
gerais estão em `skills/shared/flow.md`; os detalhes específicos de Angular, aqui e em
`references/`.

| Fase | Produz | Fecha quando |
| ---- | ------ | ------------ |
| 1. Contexto | mapa de componentes/rotas/serviços afetados | você sabe onde mexer na árvore Angular |
| 2. Spec + Tarefas | `02-specs/{NNN}-{slug}/spec.md` | tarefas executáveis, contratos de component/service definidos |
| 3. Implementação | código standalone + signals + novo control flow | `ng build` e a suíte existente passam |
| 4. Review + Testes | `verdict: ready \| blocked` com `arquivo:linha` | comportamento alvo bate com o código |
| 5. Report | decisões não óbvias + achados fora de escopo | próxima sessão retoma sem ler o diff |

## Princípios Angular

1. **Standalone é default.** Sem `NgModule`. Componentes, diretivas e pipes declaram
   `imports`/`template`/`standalone: true` (default em Angular 22). Rotas usam
   `loadComponent`/`loadChildren` para lazy.
2. **Signals primeiro.** `input()`, `model()`, `output()` (signals), `viewChildren()`/
   `contentChildren()` (signals), `computed()`, `effect()`, `signal()`. RxJS interop via
   `toSignal`/`toObservable` — não quebre em `BehaviorSubject` sem motivo.
3. **Novo control flow.** `@if`, `@for ... track`, `@switch` dentro do template. Sem
   `*ngIf`/`*ngFor` legados.
4. **`inject()` em vez de constructor DI.** Mais legível e amigo de helper functions.
5. **OnPush por signals, não por `ChangeDetectionStrategy`.** Quando zoneless, `OnPush` é
   implícito via signals; não chame `markForCheck` manualmente.
6. **Zoneless.** `provideExperimentalZonelessChangeDetection()`. Logo: nunca `setTimeout`+
   mutate state sem `signal`; use `effect`, `afterRenderEffect` ou `setTimeout` que toca
   signal — ok, pois signals agendam mudança.
7. **`httpResource()`/`resource()` para dados remotos.** Quando o dado é consulta + cache,
   prefira `httpResource`; para mutações, `HttpClient` + signal service. Sem `async pipe`
   direto em http sem boundary de erro.
8. **A11y de primeira classe.** `cdk-a11y` (LiveAnnouncer, FocusTrap, ListKeyManager),
   `aria-*` em todo controle, `role` semântico, contraste AA. Toda lista tem loading,
   erro e vazio.
9. **Hydration habilitada.** `provideClientHyration()`. Sem manipulação direta de DOM que
   quebre hidratação (evite `ElementRef.nativeElement.querySelector` em `ngOnInit`).
10. **Sem regra de negócioAutoritativa no frontend.** Frontend valida UX e mostra estado;
    autorização/validação final é do backend.

## Setup (na primeira vez do projeto)

1. `SDD_ROOT` (default `./project_sdd`). Árvore inexistente →
   `pwsh skills/scaffold.ps1 init <SDD_ROOT>` (ou `bash skills/scaffold.sh init`).
2. `01-context/` vazio ou esqueleto → rode `/sdd-context` antes da primeira trilha.
3. Trilha nova: `pwsh skills/scaffold.ps1 new feature <slug>`.

## As 5 fases (específicas Angular)

**1. Contexto.** Identifique componentes afetados, rotas, serviços, guards, interceptors,
`HttpInterceptorFn` (functional), e tokens de design system. Liste ambiguidades em bloco:
estado de loading/erro/vazio? quem possui o signal? lazy ou eager?Qual design token?

**2. Spec + Tarefas.** Contratos de component: entradas (`input()`), saídas (`output()`/
`model()`), consulta externa (`resource`/`httpResource`). Erros vêm de onde? Estados
loading/erro/vazio explícitos em cada bullet. Tarefas por feature folder
(`src/app/<feature>/`). Cada feature tem `*.component.ts`, opcional `*.service.ts`,
`*.routes.ts` (lazy).

**3. Implementação.** Padrões em `references/arquitetura.md`. Um commit por task
(`shared/git-conventions.md`). Não rode `ng serve` se já estiver de pé — só `ng build`
quando o review exigir. Use `inject()` em todo lugar. **Sem `any`** — use `unknown` +
narrow ou tipos discriminados.

**4. Review + Testes.** Delegue ao `reviewer`. Suíte em Web Test Runner (Karma deprecated).
Teste novo só para lógica pura: validators, pipes, reducers de signal. Não escreva teste
de template/e2e por trilha — Playwright é outra trilha.

**5. Report.** Decisão de arquitetura Angular (signal vs BehaviorSubject, lazy vs eager,
`resource` vs `httpResource`), armadilhas de zoneless, a11y pendente.

## Regras duras

- **Nunca** `markForCheck`, `detectChanges`, `ChangeDetectorRef` — quebra o modelo
  zoneless. Se acha que precisa, o signal está mal modelado.
- **Nunca** `ElementRef` para manipular DOM fora de diretivas/desenha gráfico. Quebra
  hydration e SSR.
- **Sem hardcode hex/CSS inline.** Use tokens (`bg-card`, `text-foreground`...). `cn()`
  util para mesclar se Tailwind.
- **Sem `| async` em signal.** Signals não são observáveis; use `@if (resource.value(); as
  v)` ou `resource.value().data`.
- **Não mexa em `main.ts`/`app.config.ts` de provedores globais sem ser tarefa explícita.**

## Limitação (declare no recibo)

Você não tem navegador: review de visual e interação é **estático** (template, a11y no
markup, SSR/hydration no código). Item visual/UX → marque `requires_human_validation`.