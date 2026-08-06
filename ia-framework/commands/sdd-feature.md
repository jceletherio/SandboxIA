---
description: Feature de escopo já claro, sem decisão em aberto — Contexto → Implementação → Review+Report. Seleciona stack via ia-framework/STACK.md ou --stack=<id>. Pula a fase de spec; comportamento alvo cabem em 3–5 bullets antes de implementar. Escale para /sdd se aparecer decisão no meio.
args: [--stack=<id> <slug>]
---

Feature de **escopo claro**: dá para descrever em uma frase o que fazer e onde, e não há
decisão de produto pendente.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.

## Como escolher a stack

1. Se `$ARGUMENTS` contém `--stack=<id>`, use-a.
2. Senão, leia `ia-framework/STACK.md` e infera da raiz touched (`frontend/` → angular;
   `backend/nodejs/` → nodejs; `backend/spring/` → spring; `backend/go/` → go; `BD/` →
   postgres). Se ainda ambíguo, pergunte.

## Pipeline equivalente no orquestrador

`Feature Simples` (categoria `sdd-simples`).

## Fases

**Contexto → Implementação → Review + Report**. Não há fase de spec separada: o
comportamento alvo cabe em 3–5 bullets antes de começar a implementar, e é contra eles que
o `reviewer` confere.

1. Slug em `$ARGUMENTS` (kebab-case), depois de `--stack=` se presente; se ausente, pergunte.
2. Carregue `skills/stacks/<stack>/references/arquitetura.md` e `convencoes.md`.
3. Localize as regiões com `grep -n`/`scaffold.<ps1|sh> context <refs>` e leia com `offset`.
4. Escreva os bullets de comportamento alvo e confirme com o usuário **em uma rodada**.
5. Implemente via agente `<stack>-implementador`. Um commit por unidade coesa. Se a
   implementação cobre componente/endpoint isolável, siga a sugestão do implementador e
   rode `/test-add functional|integration --stack=<id> <descrição>`.
6. Agente `reviewer` confere os bullets contra o código e roda a suíte existente.
7. Report: decisões não óbvias + achados fora de escopo. **Ao final do prompt**, sugira:
   "Para cobertura de sistema/aceitação/E2E ao final do desenvolvimento, rode
   `/tests-release --stack=<id>`; persiste plano em `docs/testing/test-plan-<stack>.md`."

Escale para `/sdd` se aparecer decisão de produto, se a mudança alterar contrato que outra
parte consome, ou se o escopo crescer. Escalar no meio é barato; descobrir no review que
faltava uma decisão não é.