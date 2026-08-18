# Angular 22 — Convenções

## Nomeação

- **Component**: `OrderDetailComponent`, selector `app-order-detail`. Pasta `order-detail/`.
- **Directive**: `appHighlight` (attribute), `appPermission` (structural). Arquivo:
  `highlight.directive.ts`, `permission.directive.ts`.
- **Pipe**: `OrderStatusPipe`, name `orderStatus`. Para transformações de display.
- **Service**: `CartService`, `AuthService` — injectable `providedIn: 'root'`.
- **Models**: `*.model.ts` exportando interfaces/types. `OrderVm`, `OrderDto`. `Vm` para
  view model, `Dto` para backend payload.

## Signal naming

- Estado mutável local: `_items` (privativo, `signal`), exposto `items = _items.asReadonly()`.
- Entrada: `readonly id = input.required<string>();`
- Saída: `readonly selected = output<Order>();`
- Two-way: `readonly filter = model<OrderFilter>(...)`. Template `[(filter)]`.
- Filhos: `readonly cards = viewChildren<OrderCardComponent>('cardRef')`.
- Derivado: `readonly vm = computed(() => ...)`.
- Resource: `readonly orders = httpResource<...>(...)`.

## Imports

Standalone components importam só o que usam. Ordem sugerida:

1. Módulos do Angular (`CommonModule` raramente — usar `@if/@for` em vez de `NgIf`).
2. Material/CDK ou design-system próprio.
3. Pipes/directives locais.
4. Componentes filhos.
5. `RouterOutlet`, `RouterLink`, `RouterLinkActive`.

Sem `NgModule`. `CommonModule` só em snippets legacy isoladas.

## Estrutura de template

```html
@if (vm().loading)       { <app-skeleton /> }
@else if (vm().error)    { <app-error-state [error]="vm().error()" /> }
@else if (vm().items.length === 0) { <app-empty-state action="add" /> }
@else {
  <ul>
    @for (item of vm().items; track item.id) {
      <li>...</li>
    } @empty {
      <li>Nenhum item.</li>
    }
  </ul>
}
```

- `track` obrigatório em `@for` — sem `track` vira lint error.
- `@empty` para lista vazia quando iteção for elegante.
- Sem `*ngIf`, `*ngFor`, `*ngSwitch` legados.

## Convenções de estilo (Tailwind ou CSS)

- **Sem hex cravado fora de estilos que mimificam terminal/console**. Use tokens
  (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`).
- `cn()` de `@/lib/utils` (ou local) para classes condicionais.
- Escala tipográfica apertada (mesma convenção do projeto base):
  `text-[10px]` rótulos uppercase, `text-xs` corpo, `text-sm` título de página.
- A11y: `aria-label` em todo IconButton; `role` semântico.
- Responsivo: breakpoint principal `lg`. Não regressa mobile.

## Comentários

- **Não adicionar** salvo solicitação. Convenção do projeto.
- **Sem emojis** — nunca em comentário de código.
- Se inevitável: PT-BR no corpo, ULTRA curto, justificando o porquê não o quê.

## Código limpo (regras gerais)

- **Nomes**: descritivos, sem abreviações; booleanos com prefixo `is/has/can/should`;
  identificadores em inglês; comentários e mensagens em PT-BR.
- **Funções**: curtas (≤ 25 linhas) e com uma responsabilidade; `early return` em vez de
  `if/else` aninhado (máx. 2-3 níveis).
- **Tipos explícitos**: sem `any`; sem `var`; estados com tipos discriminados.
- **Sem código comentado** — delete em vez de comentar.
- **Sem magic number/string** — constante nomeada, enum ou token.
- **Sem `console.log`/`debugger`** — use o logger do projeto.
- **Sem `TODO`/`FIXME` órfãos** — resolve na task ou vira backlog no review.
- **Formatter/lint antes do commit** (prettier + eslint; typecheck limpo).
- **DRY por regra de três** — 3ª duplicação extrai; sem over-abstract antecipado (YAGNI).

## Testes

- Web Test Runner (Karma deprecated em Angular 22). Vitest compatível.
- Teste novo só onde lógica é pura (pipes, validators, reducers de signal, mappers).
- Nome: `*.spec.ts` ao lado doarquivoえそ tested.
- Não escreva e2e em trilha SDD — Playwright étrilha separada.

## Commit

`shared/git-conventions.md`. Scope sugerido: `orders`, `auth`, `router`, `signals`,
`a11y`. Exemplo:

```
feat(orders): adiciona resource de listagem com estado de loading/erro/vazio
```

## Hardlines do projeto-base

- Não rode `ng serve`, `ng build` em main thread — Angular CLI gerencia o watch mode na
  porta 4200 se já de pé.
- Não rode `ng generate` sem pedir.
- Não mexa em `angular.json` configs de production sem ser tarefa explícita.