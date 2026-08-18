---
description: Prepara o projeto para testes — instala dependências, cria configs (vitest, playwright, Makefile para Testcontainers, application-test.yml, pgTAP tests dir). Uma vez por stack ativa. Delega ao agente `test-setup`. Não escreve testes individuais — use `/test-add`.
args: [--stack=<id|all>]
---

Setup inicial de testes em uma ou todas as stacks ativas.

## Quando usar

- Início de projeto (verde) — prepara tooling para Vitest, JUnit5, `testing`, Playwright,
  Testcontainers, pgTAP.
- Antes de rodar `/test-add` ou `/tests-run` pela primeira vez.
- Após adicionar nova stack em STACK.md.

## Quando NÃO usar

- Tooling já configurado e funcional → `test-setup` reporta skip.
- Para escrever testes individuais → `/test-add`.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se `src/frontend/package.json` etc. ausente, sugira `/setup-tooling --deps`
> chained antes — este command cria configs mas não instala runtime deps.

## Condução

1. `$ARGUMENTS`: `--stack=<id|all>`. Default `all` (todas em `ia-framework/STACK.md`).
2. Garanta existência de `ia-framework/STACK.md` — se ausente, peça ao usuário definir
   stacks antes.
3. Delegue ao agente `test-setup`:
   - Para cada stack ativa:
     angular: configura `vitest.config.ts`, `test-setup.ts`, scripts `npm`,
       `src/frontend/e2e/playwright.config.ts`, `.gitignore` para `test-results/` e
       `playwright-report/`.
     nodejs: adiciona `vitest`, `@testcontainers/postgresql` ao `devDependencies`;
       cria `vitest.config.ts`; scripts `test`, `test:integration`.
     spring: adiciona testcontainers+junit-jupiter+postgresql ao `pom.xml`/`build.gradle`;
       cria `application-test.yml`.
     go: `go get` no módulo de `testcontainers-go`/`postgres TC module`; cria/ajusta
       `Makefile` targets `test`, `test-unit`, `test-integration`.
     postgres: cria `src/BD/sql/tests/` com README pgTAP; scripts `scripts/test-db.sh` que
       sobe container e roda pgTAP.
4. Receba recibo do `test-setup` (schemas do `architect-output` não se aplica — recibo é
   lista de arquivos alterados + dependências pendentes).
5. **Apresente ao usuário** a lista de dependências que ele deve instalar:
   - `cd frontend && npm install`
   - `cd src/backend/nodejs && npm install`
   - `cd src/backend/spring && ./mvnw clean install -DskipTests` (resolve deps estendidas)
   - `cd src/backend/go && go mod tidy`
   - `npx playwright install --with-deps chromium webkit` (frontend e2e)
   - `apt install poppler-utils` ou similar para `pg_prove` (postgres tests)
6.**Não instale nada automaticamente.** O usuário controla banda/lockfiles/rede.

## Limitação

- Sem Docker/Nix global: Testcontainers/Playwright exigem runtime confirmado em uso
  posteriormente por `/tests-run`.
- `test-setup` NÃO escreve testes individuais — pair com `/test-add`.

## Após setup

Prossiga com `/test-add <level>` para escrever testes conforme a trilha SDD atual, ou
rode `/tests-run --stack=<id>` para ver o estado (vai pular tudo que ainda não tem specs).