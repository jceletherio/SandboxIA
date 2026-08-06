---
description: Roda a geracao de testes de final de desenvolvimento — sistema, aceitação e E2E — para uma ou todas as stacks ativas. Delega a `test-author` em níveis final. Salva plano de testes em `docs/testing/test-plan-<stack>.md`. Use ao concluir um eixo de desenvolvimento (trilha release candidate, feature completa).
args: [--stack=<id|all>]
---

Fase final de testes para um release/emissão.

## Quando usar

- Ao concluir uma trilha/release candidate — совета cobertura de sistema/aceitação/E2E.
- Antes de abrir PR de release: combina com `/generate-architecture` para anexar plano.
- Fase 5 do SDD: prompt final de `/sdd` sugere este command.

## Quando NÃO usar

- Durante implementação pontual — use `/test-add <level>`.
- Bug-fix reprodução — use `/tests-regression`.
- Setup inicial — use `/tests-setup`.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se tooling de testes não está configurado, sugira `/tests-setup --stack=<id>`
> chained antes.

## Condução

1. `$ARGUMENTS`: `--stack=<id|all>` (default `all`). Para cada stack ativa:
   a. **Carregue a spec da trilha** finalizada relevante (ou conjunto de specs) e extraia
      os bullets da seção "Comportamento alvo" — cada bullet vira um cenário.
   b. Delegue ao agente `test-author` em níveis final:
      - `system` para cada stack backend: checa healthcheck (`/health`, `/actuator/health`),
        auth (`401`/`403` sem token), smoke público. Use `curl`/HTTP client/Playwright API.
      - `acceptance` para cada stack: cada critério de aceite da spec vira teste HTTP (ou
        Playwright UI, se Angular).
      - `e2e` quando há frontend: Playwright cross-stack UI+API (frontend Angular + backend).
      - Para postgres: pgTAP final para confirmar schema e RLS, + (opcional) benchmarks.
   c. Receba recibo de cada `test-author` invocação e combine.
   d. **Compile** `docs/testing/test-plan-<stack>.md` listando:
      - Stack e versãocoberta.
      - Números de testes por nível (system, acceptance, e2e).
      - Caminhos dos artefatos (ex.: `frontend/e2e/orders-create.spec.ts`).
      - Cenários mapeados à spec/trilha por ID.
      - Comandos de execução (`/tests-run --stack=<id> --level=acceptance`).
4. Garanta `docs/testing/` existe:
   ```
   New-Item -ItemType Directory -Force -Path docs/testing
   ```
5. **Apresente recibo ao usuário**:
   - Lista de arquivos de teste gerados por stack.
   - Plano de testes persistido (`docs/testing/test-plan-<stack>.md`).
   - Próximo passo sugerido: `/tests-run --stack=all` para confirmar passing antes do
     release.

## Saída esperada em disco

```
docs/testing/
  test-plan-frontend-angular.md
  test-plan-backend-nodejs.md, test-plan-backend-spring.md, test-plan-backend-go.md
  test-plan-database-postgres.md
frontend/e2e/<stack>.<scenarios>.spec.ts       # Playwright
backend/<stack>/.../system/Acceptance*.java   # JUnit etc.
BD/sql/tests/<tema>_<final>.sql   # pgTAP
```

## Limitação

- Demanda Docker para Testcontainers/Playwright — peça confirmação.
- Não substitui execução contínua CI; o plano é snapshot per-release.
- Não faz smoke de produção — apenas da versão release candidate na mesma stack do repo.