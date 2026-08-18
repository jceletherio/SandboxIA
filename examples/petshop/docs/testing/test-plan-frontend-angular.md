---
title: Plano de testes — Frontend Angular
stack: angular
updated: 2026-08-05
kpis: { health: green }
---

# Plano de testes — Frontend Angular — Petshop PetLover

> Exemplo de snapshot gerado por `/tests-release --stack=angular`.

## Níveis cobertos

| Nível | Framework | Count | Trace/artefato |
| ----- | --------- | ----- | ---------------- |
| Unitário | Vitest | 12 | `src/**/*.spec.ts` |
| Funcional | Testing Library Angular | 6 | `src/**/*.spec.ts` (TestBed) |
| Sistema | n/a (jurisdição backend) | — | — |
| Aceitação | Playwright | 5 | `src/frontend/e2e/*.spec.ts` |
| E2E | Playwright cross-stack | 3 | `src/frontend/e2e/*.spec.ts` |

## Cenários de aceitação (cada CA da spec → cenário)

### Trilha 003 — orders-ui

- CA-1 "Fazer primeiro pedido" mostra CTA no estado vazio → `src/frontend/e2e/orders-empty.spec.ts`
- CA-2 Tab order: cabeçalho → sidebar → tabela → footer → `src/frontend/e2e/orders-a11y.spec.ts`
- CA-3 Filtrar status "Pago" atualiza lista → `src/frontend/e2e/orders-filter.spec.ts`
- CA-4 Erro de rede mostra retry → `src/frontend/e2e/orders-error.spec.ts`
- CA-5 Skeleton aparece durante loading → `src/frontend/e2e/orders-loading.spec.ts`

## Comandos de execução

```
cd src/frontend && npx vitest run                   # unitário + functional
cd src/frontend && npx playwright test              # aceitação + E2E
cd src/frontend && npx playwright test --grep @a11y # só a11y
```

## Trace artefatos

- Em bug: `src/frontend/test-results/<test>/trace.zip`
- Em E2E E2E failure: `src/frontend/playwright-report/` HTML

## Próximas progressões (não desta release)

- Component Visual Regression com Playwright + Percy/Chromatic (futuro).
- Mutation testing com Stryker (opcional).