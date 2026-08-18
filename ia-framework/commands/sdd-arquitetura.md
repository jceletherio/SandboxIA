---
description: Decisão de arquitetura de uma stack (frontend Angular, backend NodeJS/Spring/Go, BD Postgres). Delega ao agente <stack>-arquiteto. Não implementa código. Use quando há decisão em aberto sobre camadas, contratos, modelagem, particionamento, RLS, state management, e não há spec ainda — a saída do arquiteto alimenta a spec da trilha SDD.
args: --stack=<id> [tópico]
---

Dispara o agente **arquiteto** da stack escolhida para produzir decisões acionáveis que
alimentarão a spec SDD da trilha.

## Argumentos

- `--stack=<id>` obrigatório. `<id>` ∈ `angular | react | nodejs | spring | go | postgres`. Se
  ausente, pergunte em uma rodada só.
- `[tópico]` opcional: descrição curta do problema em aberto (ex.: "modelo de dados para
  pedidos multi-tenant com heterarquia de clientes").

## Quando usar

- Há decisão de arquitetura em aberto (camadas, contratos, modelagem DB, particionamento,
  state management Angular, tx boundary).
- Ainda não há spec escrita; a saída do arquiteto entra na fase 2 (Spec+Tarefas).

## Quando NÃO usar

- Decisão reversível ou de baixo impacto — fica como parágrafo na spec do `/sdd` normal.
- Decisão envolvendo mais de uma stack (ex.: "contrato entre Angular e Spring") — abra
  um `/sdd` que toca ambas as stacks; o `reviewer` cuida da coerência cross-stack.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.

## Condução

1. Confirme `--stack=<id>` em `$ARGUMENTS`.
2. Carregue `ia-framework/STACK.md` e a skill/references da stack:
   `skills/stacks/<stack>/SKILL.md` e `references/arquitetura.md`, `seguranca.md`,
   `convencoes.md`.
3. Delegue ao agente `<stack>-arquiteto`:
   - Passa `01-context/` + tópico + arquivos relevantes (`grep -n`/`Read offset`).
   - O arquiteto devolve JSON `architect-output.schema.json` com `decisions`,
     `contracts`, `blockers`, `adr_proposed`.
4. Apresente o recibo ao usuário:
   - Decisões propostas + razão + alternativas descartadas.
   - Contratos que devem ser honrados na implementação.
   - Blockers (se algum) que impedem prosseguir — responda ou gere `/sdd`.
5. Para cada decisão `adr_proposed: true` (arquitetural irreversível), crie o ADR com o
   template `skills/templates/03-decisions/adr-template.md` durante a fase 5 (Report) do
   `/sdd` subsequente.
6. Encaminhe: gere `/sdd` (ou `/sdd-feature` se escopo fechou) consumindo estas decisões
   como base da fase 2 (Spec+Tarefas).