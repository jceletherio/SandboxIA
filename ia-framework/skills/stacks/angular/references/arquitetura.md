# Angular 22 — Padrões de Arquitetura

## Estrutura de pastas — feature folders

```
src/
  app/
    <feature>/
      <feature>.component.ts          standalone, selector `app-<feature>`
      <feature>.component.html        template (inline se < 20 linhas)
      <feature>.service.ts            signal-based se tem cache; senão HttpClient wrapper
      <feature>.routes.ts             Routes[] com loadComponent/loadChildren
      <feature>-form/                 sub-feature (form)
      models/                         tipos do domínio da feature
      _state/                         signals de estado local (se >= 3 sinais)
    core/
      http/                           HttpInterceptorFn, httpContext token de tenant
      auth/                           guard `canMatch` functional, auth.service
      layout/                         shell, header, sidebar
    shared/
      ui/                             botão, card, dialog (todos standalone, reusable)
      directives/                    highlight,permission
      pipes/                          custom pipes
  assets/
  styles/                             tokens, design-system
  main.ts                             bootstrapApplication com providers
  app.config.ts                       provideRouter, provideHttpClient(withFetch),
                                     provideClientHyration, provideZoneless...
```

## Providers de bootstrap (`app.config.ts`)

```ts
provideExperimentalZonelessChangeDetection(),
provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling()),
provideHttpClient(withFetch(), withInterceptors([authInterceptor, errorInterceptor])),
provideClientHyration(),
provideAnimationsAsync(), // só se realmente usar
```

`withComponentInputBinding()` liga params de rota a `input()` do componente — preferido a
`ActivatedRoute`订阅.

## Componentes — sinais como API

```ts
@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [OrderCardComponent, JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush, // obrigatório mesmo zoneless
  template: `...`,
})
export class OrdersComponent {
  // entradas
  readonly tenantId = input.required<string>();
  readonly filter = model<OrderFilter>({ status: 'open' });

  // saídas
  readonly selected = output<OrderVm>();

  // filhos
  readonly cards = viewChildren<OrderCardComponent>('cardRef');

  // estado derivado (computed)
  readonly vm = computed(() => ({
    items: this.ordersResource.value()?.items ?? [],
    loading: this.ordersResource.isLoading(),
    error: this.ordersResource.error() ?? null,
  }));

  // recurso remoto (cache + refetch controlado)
  readonly ordersResource = httpResource<OrdersResponse>(
    () => `/api/v1/orders?tenant=${this.tenantId()}`,
    { parse: (r) => schemaGuard('OrdersResponse', r) },
  );

  constructor() {
    effect(() => console.log('filter changed', this.filter()));
    // efeito colateral — trajeto permits / re-fetch / analytics
  }
}
```

- `input.required()` quando vazio é erro de programação (throw no build runtime).
- `model()` habilita two-way do template: `[(filter)]="..."`.
- Não quebra em serviços injetáveis para lógica — componente fica fino.

## Serviços — signal-based quando há estado

```ts
@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly _items = signal<CartItem[]>([]);
  readonly items = this._items.asReadonly();
  readonly total = computed(() => this._items().reduce((s, i) => s + i.price * i.qty, 0));

  add(item: CartItem) { this._items.update(v => [...v, item]); }
  remove(id: string) { this._items.update(v => v.filter(i => i.id !== id)); }
}
```

Sem `BehaviorSubject` novo — `BehaviorSubject` só para interop RxJS quando um consumidor
exigir Observable.明明 `toSignal`/`toObservable`.

## Rotas — lazy functional guards

```ts
export const ORDERS_ROUTES: Routes = [
  {
    path: '',
    canMatch: [isAuthenticated()],
    loadComponent: () => import('./orders.component').then(m => m.OrdersComponent),
    children: [
      { path: ':id', loadComponent: () => import('./order-detail').then(m => m.OrderDetailComponent) },
    ],
  },
];
export function isAuthenticated(): CanMatchFn {
  return () => inject(AuthService).isAuthenticated();
}
```

`CanMatchFn` (não `CanLoad`, deprecated), `CanActivateFn`. Sem `Resolve` — `httpResource` é
o loader.

## Interceptors — functional

```ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
```

Sem classes `HttpInterceptor`. Compose com `withInterceptors([a, b, c])`.

## Estado de loading/erro/vazio — sempre três

Toda koleção/visualização usa o `vm` (computed) com `{ items, loading, error }`. Template:

```html
@if (vm().loading)       { <app-skeleton /> }
@else if (vm().error)    { <app-error-state [error]="vm().error()" /> }
@else if (vm().items.length === 0) { <app-empty-state action="..." /> }
@else {
  @for (item of vm().items; track item.id) {
    <app-order-card [order]="item" (select)="selected.emit($event)" />
  }
}
```

Sem `*ngIf`. `track` obrigatório em `@for`.

## Estados com efeitos — efeito colateral via `effect`

```ts
constructor() {
  effect(() => {
    if (this.filter().status === 'all') localStorage.setItem('orders:filter', 'all');
  });
}
 资源Reloaded
```

Efeitos rodam em scheduling pós-render; não use para derivar estado (`computed`)
nem para mudança de estado longa (`afterNextRender`/`afterRender`).

## Não faça

- `ChangeDetectorRef.markForCheck` (`OnPush` por signals).
- `setInterval` para tocar estado. Use `effect` + `timer` RxJS convertido a signal.
- `router.navigate` por string — use comando tipado ou `RouterLink`.
- Lógica de domínioAutoritativa (regras de negócio canônico, autorização) no componente.
- `elementRef.nativeElement.value = ...` — ngModel ou signal em vez disso. Quebra SSR.