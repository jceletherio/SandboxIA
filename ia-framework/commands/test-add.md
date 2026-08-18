---
description: Escreve um novo teste num nível dado para uma stack ativa. Delega ao agente `test-author`. Não implementa código de produção; se falta código, o agente reporta e para. Para bug-fix (regressão), use `/tests-regression`. Para rodar, use `/tests-run`.
args: <level> [--stack=<id>] [descrição]
---

Adiciona um teste específico por oportunidade durante o desenvolvimento.

## Quando usar

- Durante `/sdd` ou `/sdd-feature` fase 3, quando a tarefa cobre uma funcionalidade que
  merece mais que teste unitário (componente isolável, endpoint, etc.).
- Após implementador escrever testes apenas para lógica pura e você quer adicionar:
  - `functional` para componente Angular com TestBed
  - `integration` para endpoint Node/Spring/Go com BD real (Testcontainers)
  - `acceptance`/`e2e` (não recomendado em fase 3; prefira `/tests-release` ao final).

## Quando NÃO usar

- Lógica pura → `<stack>-implementador` já escreveu no mesmo commit.
- Bug-fix → `/tests-regression`.
- Cobertura de sistema/aceitação/E2E no final → `/tests-release`.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se tooling de testes não está configurado (ex.: `vitest.config.ts` ausente),
> sugira `/tests-setup --stack=<id>` chained antes.

## Condução

1. `$ARGUMENTS`:
   - `<level>` ∈ `unit | functional | integration | system | acceptance | e2e`
   - `--stack=<id>` (default: derivar da raiz touched via `STACK.md`)
   - `descrição` (texto livre) — o que o teste cobre
2. Confirme que `test-setup` correu para a stack — senão, sugira rodar primeiro.
3. Delegue ao agente `test-author`:
   - Carrega `skills/testing/references/levels.md` + `frameworks.md` +
     `skills/stacks/<stack>/references/testing.md`.
   - Localiza arquivo vizinho e template seed em `skills/testing/templates/testing/`.
   - Escreve teste no nível pedido.
   - Rode uma vez para confirmar green (sem Docker se não confirmado — reporte).
4. Receba JSON recibo e apresente ao usuário:
   - Caminhos dos arquivos criados/alterados.
   - `how_to_validate` — comando para repetir a execução.

## Saída esperada

```
test-add ok
level: functional | stack: angular
files:
- src/frontend/src/app/orders/orders.component.spec.ts (criado)
how_to_validate: cd frontend && npx vitest run src/app/orders/orders.component.spec.ts
```

## Limitação

- `test-author` não implementa código de produção — se falta implementação, inginforme no
  recibo que o implementador deve cobrir primeiro.
- Não escreve teste de regressão — para isso, `/tests-regression`.
- `system`/`acceptance`/`e2e` exigem backend+container+BD subidos; recomende `/tests-release`.