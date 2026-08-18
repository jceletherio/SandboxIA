---
description: Gera ou atualiza documentação de arquitetura do projeto em `docs/architecture/` — um doc por stack ativa + `overview.md` cross-stack. Delega aos 6 agentes `<stack>-arquiteto` existentes via agente `architecture-writer`. Markdown + Mermaid. Use após decisões arquiteturais maduras (post-spec ou pre-release).
args: [--stack=<id|all>]
---

Persiste decisões arquiteturais em `docs/architecture/`.

## Quando usar

- Após ADRs aceitos em `03-decisions/` que afetam uma ou mais stacks.
- Pré-release — garantir documentação técnica atualizada.
- Quando `STACK.md` muda (feedback de onboarding: "faltam docs para X").

## Quando NÃO usar

- Decisão reversível — vira parágrafo na spec da trilha.
- Mudança pontual de código sem impacto arquitetural.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se `docs/architecture/` ausente, crie via `Bash` (`mkdir`) silenciosamente —
> não bloqueia workflow (não é invariável crítica de setup).

## Condução

1. `$ARGUMENTS`:
   - Default: `--stack=all` (gera/atualiza todos os docs das stacks ativas em STACK.md).
   - `--stack=<id>`: só aquele doc (ex.: `--stack=spring` reescreve `backend-spring.md` e
     atualiza linha em `overview.md`).
2. Garanta `docs/architecture/` existe:
   ```
   New-Item -ItemType Directory -Force -Path docs/architecture
   ```
3. Delegue ao agente `architecture-writer`:
   - Para cada stack ativa (ou só a passada):
     a. Carrega `skills/stacks/<stack>/references/arquitetura.md`, `seguranca.md`,
        `convencoes.md`.
     b. Delega ao agente `<stack>-arquiteto` correspondente (devolve JSON
        `architect-output`).
     c. Compila no template `skills/architecture/templates/architecture/<stack>.md`.
     d. `Write` para `docs/architecture/<stack>.md` (override + bump `updated`).
   - Atualiza `docs/architecture/overview.md` cross-stack.
4. Para cada ADR que o arquiteto propôs (`adr_proposed: true`):
   - Crie `03-decisions/ADR-NNN-<slug>.md` com template
     `skills/templates/03-decisions/adr-template.md`.
   - Liste ADRs no recibo e peça aceite.

## Saída esperada em disco

```
docs/architecture/
  overview.md                       # stack: multi
  frontend-angular.md              # se angular ativo
  frontend-react.md                # se react ativo
  backend-nodejs.md                # se nodejs ativo
  backend-spring.md                # se spring ativo
  backend-go.md                    # se go ativo
  database-postgres.md             # se postgres ativo
03-decisions/
  ADR-NNN-<slug>.md                # conforme propostos (status proposed)
```

## Limitação

- Sem runtime/cluster: `EXPLAIN ANALYZE` e métricas de prod não são coletadas — decisões
  são estáticas baseadas no código + `01-context/` + ADRs aceitos.
- A saída é snapshot; se o código evoluiu sem ADR, o doc gerado resume o que está lá.
- Não substitui `01-context/` — que é memória viva; este é snapshot per-release.

## Pipeline sugerido

1. `/plan-from-requirements <file>` — gera trilhas e plano.
2. Para cada trilha: `/sdd --stack=<id> <NNN> <slug>`.
3. Decisões irreversíveis viram ADRs no `/sdd` fase 5.
4. Após aceitação das ADRs: `/generate-architecture --stack=all`.
5. Antes do release: `/tests-release --stack=all` para gerar plano de testes em
   `docs/testing/test-plan-<stack>.md`.