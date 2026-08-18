---
description: Confere alinhamento entre contrato backend publicado (`01-context/api-context.md`) e consumidores no frontend Angular (`httpResource`/`HttpClient`) e tipos. Lista divergências de path/verbo/schema/status code. Delega a `contract-checker` (read-only). Não edita código; reporta.
---

Confere o contrato backend ↔ frontend antes de liberar release.

## Quando usar

- Pré-merge de trilha que afeta contrato (`POST /api/v1/orders` altera `OrderVm`).
- Pré-release: roda antes de `/tests-release --stack=all`.
- Quando frontend reclama de 500/422 e você quer achar divergência antes do deploy.

## Quando NÃO usar

- Sem mudança de contrato (`docs/api-context.md` inalterado) → skip.
- Backend ainda não publicou nada (`api-context.md` vazio) → primeiro rode
  `/generate-architecture` para snapshot e popule o `api-context.md`.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se `01-context/api-context.md` ausente (não há contrato publicado), abort e
> sugira `/generate-architecture` primeiro antes do contract-check.
>
> Extra protótipo: se `01-context/prototype/` existir (partes `P-NNN`) mas `api-context.md`
> ainda vazio, use os **DTOs do mock** (`src/frontend/src/app/prototype/core/api/*.gateway.ts`)
> como a fonte esperada de contrato — o backend real deve entregar o que o mock prometeu
> (ver `skills/prototyping/references/feeding-sdd.md` §release). Não aborte nesse caso.

## Condução

1. Determine a fonte do contrato:
   - `01-context/api-context.md` populado → contrato publicado (fonte principal).
   - `api-context.md` vazio **mas** `01-context/prototype/` existe → use os DTOs do mock
     (`src/frontend/src/app/prototype/core/api/*.gateway.ts`) como contrato esperado; informe
     no recibo que `checked_against` é o mock.
   - Ambos ausentes → abort (não há contrato para conferir).
2. Delegue ao agente `contract-checker`:
   - Lê `ia-framework/STACK.md` e a fonte do contrato (passa `api-context.md` e/ou os
     paths dos gateways do protótipo quando usados como fonte).
   - Varre frontend (`httpResource`, `HttpClient`) e backend (handlers/controllers/routes).
   - Compara paths, verbs, schemas, status codes.
   - Devolve JSON com findings (critical/high/medium/low) e verdict.
3. Apresente recibo ao usuário:
   - Findings ordenados por severidade.
   - Para cada `critical`/`high`: sugira abrir `/sdd-feature` ou `/sdd-bug-fix` para
     o específico.
   - Itens `medium`/`low` viram backlog em `03-decisions/` (ou issue tracker).

## Saída esperada

```
contract-check: stack=spring+angular
findings: 4
  DIV-001 critical  OrderVm sem externalRef no frontend (orders.component.ts:42)
  DIV-002 high      POST /orders sem handler de 409
  DIV-003 medium     /api/v2/... em arquivo legado
  DIV-004 low        /actuator/health não documentado
verdict: blocked
```

## Limitação

- Read-only — não corrige. Corrigir é outra invocação (`/sdd-feature`/`/sdd-bug-fix`).
- Não roda testes runtime; checagem é estática. Para validar runtime, use
  `/tests-run --level=integration` depois do fix.

## Pipeline sugerido (release)

```
1. Última trilha SDD concluída (verdict ready)
2. /generate-architecture --stack=all       # atualiza docs/architecture/ + api-context
3. /contract-check                          # confere frontend ↔ backend
4. /tests-release --stack=all               # gera testes finais em docs/testing/
5. /tests-run --stack=all                   # roda tudo
6. Merge do release
```