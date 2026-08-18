# Angular — Testing

## Stack�能

- **Angular 22** standalone, signals, novo control flow `@if/@for/@switch`, zoneless.
- **Regras fortes** (ver SKILL.md): sem `markForCheck`/`detectChanges`/`ChangeDetectorRef`;
  sem `*ngIf`/`*ngFor` legacy em teste novo.

## Níveis × Frameworks

| Nível | Framework | Notas |
| ----- | --------- | ----- |
| Unitário | Vitest (preferido) ou Jest | `test environment: 'jsdom'`. Testa validators, pipes, mappers, `computed` selectors. |
| Funcional | Testing Library Angular (`@testing-library/angular`) + `TestBed` | Renderiza componente mockando `httpResource` via `HttpTestingController`. |
| Integração | `TestBed` + `provideHttpClientTesting` + providers reais | Quando feature usa `signal` store que chama outros serviços reais. |
| Aceitação/E2E | Playwright (testDir `src/frontend/e2e/`) | User journeys, baseURL `http://localhost:4200`. |

## Setup项目的

`test-setup` instalará:
- `vitest`, `@angular/build`, `@vitest/coverage-v8`, `jsdom`
- `@testing-library/angular`, `@testing-library/jest-dom`
- `@playwright/test` em `src/frontend/e2e/` (numpy playwright.config.ts)

`angular.json` target `test`: `npx vitest run`.
`angular.json` target `e2e`: `npx playwright test`.

## Unitário — boilerplate

```ts
import { describe, it, expect } from 'vitest';
import { OrderStatusPipe } from './order-status.pipe';

describe('OrderStatusPipe', () => {
  const pipe = new OrderStatusPipe();
  it('mapeia status para label', () => {
    expect(pipe.transform('open')).toBe('Aberto');
    expect(pipe.transform('paid')).toBe('Pago');
  });
  it('retorna input para status desconhecido', () => {
    expect(pipe.transform('foo' as any)).toBe('foo');
  });
});
```

## Funcional — Pattern com TestBed + httpResource mock

```ts
import { render, screen } from '@testing-library/angular';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { OrdersComponent } from './orders.component';

test('mostra skeleton durante loading', async () => {
  await render(OrdersComponent, {
    providers: [provideHttpClientTesting()],
    componentInputs: { tenantId: 't1' },
  });
  // httpResource inicia loading — skeleton via @if signal-driven
  expect(await screen.findByTestId('orders-skeleton')).toBeTruthy();
});

test('mostra erro quando API falha', async () => {
  const { fixture } = await render(OrdersComponent, {
    providers: [provideHttpClientTesting()],
    componentInputs: { tenantId: 't1' },
  });
  const req = http.expectOne(...); req.error(new ProgressEvent('network'), { status: 500 });
  expect(await screen.findByText(/erro ao carregar/i)).toBeTruthy();
});
```

## E2E/Aceitação — Playwright

Pasta `src/frontend/e2e/`. Cenários de aceitação derivam **dos bullets da seção "Comportamento
alvo"** da spec da trilha.

Regis-acrecentar `--mode=production` em `webServer.command` para empacotar Angular SSR build
antes dos E2E quando o projeto tem SSR/hidratação.

## Bug-fix regressão

Reproduza no nível certo:
- Component logic (signal/computed) → unitário.
- Template state transitions (loading/erro/vazio) → funcional.
- Fluxo cross-stack com backend → E2E com Playwright API context para setup.

Artefato: `trace.zip` salvo em `test-results/<nome-teste>/`. Reprodução do red capturada via
`testInfo.attach()` antes do fix.

## Não faça

- Não use `fakeAsync`/`tick` em novo — substituir por `await` em fake timers ou
  `provideFakeTimer` de Vitest.
- Não chame `fixture.detectChanges()` manualmente ao usar signals; o scheduler zoneless
  dispara automaticamente. Em Test necessite explicit call só em `TestBed` legacy.
- Não crie arquivos `.spec.ts` ao lado de `.component.ts` em tests E2E — E2E vive em `e2e/`.