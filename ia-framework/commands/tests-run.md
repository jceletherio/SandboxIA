---
description: Orquestra a execução das suítes de teste por stack e/ou nível. Roda suíte existente (não cria) — pede confirmação antes de disparar Testcontainers/Playwright que exigem Docker. Apresenta pass/fail e caminho do artefato de trace.
args: [--stack=<id|all>] [--level=<id|all>]
---

Roda as suítes já existentes com base nos filtros.

## Quando usar

- Na fase 4 do SDD — `reviewer` deve rodar a suíte, mas você também pode invocar este
  command manualmente.
- Pré-marge de trilha — verificar sanity.
- Em check incremental quando editou algo fora do escopo da spec.

## Quando NÃO usar

- Para escrever novo teste → `/test-add`.
- Para bug-fix reprodução → `/tests-regression`.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se tooling de testes não está configurado (ex.: sem `vitest.config.ts`), sugira
> `/tests-setup --stack=<id>` chained antes. Se `node_modules/` ausente, sugira
> `/setup-tooling --deps`.

## Condução

1. `$ARGUMENTS`:
   - `--stack=<id|all>` (default `all`)
   - `--level=<id|all>` (default `all`)
2. **Detecte tooling** em cada stack alvo via ` STACK.md` e leitura de `package.json`,
   `pom.xml`, `go.mod`, `Makefile`. Se não há tooling (`test-setup` não rodou), reporte
   skip.
3. **Confirme antes de disparar runtime pesado**:
   - Playwright/Integration exigem Docker/Browser? Pergunte una única vez:
     "Vou rodar Testcontainers/Playwright — cnfirma?" (uma rodada)
   - Skip seu existe configuração `.SKIP_RUNTIME` no projeto (env var op qui seja)
     definido pelo usuário.
4. **Rode as suítes** por stack/nível:
   - Angular unit/functional: `cd frontend && npx vitest run`
   - Angular e2e: `cd frontend && npx playwright test`
   - Node.js: `cd backend/nodejs && npx vitest run`; integration:
     `RUN_INTEGRATION=1 npx vitest run`
   - Spring: `cd backend/spring && ./mvnw test`; integration se filters: `-Dgroups=integration`
   - Go: `cd backend/go && go test -short ./...`; integration: `go test -tags=integration ./...`
   - Postgres pgTAP: `pg_prove -d test_db BD/sql/tests/*.sql` (se BD de teste configurado)
5. **Capture failures e traces**:
   - Playwright `trace.zip` path: `frontend/test-results/<test>/trace.zip`
   - Vitest reporter JUnit XML: `backend/nodejs/test-results/junit.xml` (se configurado)
   - JUnit5 padrão: reports em `target/surefire-reports/`
   - Go: `go test -json ./... > test-results.json`
6. **Apresente recibo**:
   ```
   tests-run ok
   stack: spring -- level: all
     unit + integration: 18 run, 2 failed
     fail: OrderIntegrationTest.unique_constraint_on_external_ref (target/surefire/...)
     target/surefire-reports/com.acme.orders.OrderIntegrationTest.txt
   ```
7. Não corrija aqui — listagem de falhas. Para correção, use `/sdd-bug-fix` para abrir a
   trilha.

## Saída esperada

- Recibo compacto por stack/nível: número de testes run, passed, failed, skipped + path
  para artefato de trace/error.

## Limitação

- Sem Docker confirmado → Testcontainers/Integration E2E skip (em CI não precisa confirmar
  — assume disponível).
- Sem cluster Postgres vivo → pgTAP skip (instrua usuário a rodar `scripts/test-db.sh`).