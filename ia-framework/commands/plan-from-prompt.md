---
description: Plano SDD a partir de prompt curto, sem documento de requisitos. Protocolo de aprovação em 4 fases (Perguntas → CAs → Plano → Execução). Nada executa antes de "Fase C aprovada" no protocol.md. Use quando o usuário descreve algo em 1-3 frases e não tem .docx/.pdf/.md pronto.
args: "<descrição curta>"
---

Plano iterativo com aprovação humana explícita em cada fase.

## Quando usar

- Usuário descreve uma feature em prompt curto (1-3 frases), sem documento de requisitos.
- Você quer garantir que o usuário valide perguntas, critérios de aceite e plano
  **antes** de implementação começar.
- Anti-alucinação: prefira este command ao `/sdd-feature` quando o escopo tem lacunas
  implícitas que precisam ser preenchidas com o usuário, não assumidas.

## Quando NÃO usar

- Há documento de requisitos `.docx/.pdf/.md`: `/plan-from-requirements` direto.
- Bug pontual: `/sdd-bug-fix`.
- Decisão de arquitetura isolada: `/sdd-arquitetura`.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.

## Condução

1. `$ARGUMENTS` traz a `<descrição curta>` (string entre aspas, ou texto livre se owner).
2. Carregue `skills/protocol/SKILL.md` e `references/phases.md`.
3. **Invoque a skill `protocol`** e conduza as 4 fases abaixo. **Regra dura**: nada
   é implementado antes da Fase C ser explicitamente aprovada.

### Fase A — Perguntas

- Leia `ia-framework/STACK.md` e `project_sdd/INDEX.md`.
- Levante 4-8 lacunas na descrição (negócio, stack, NFRs, telas, fora de escopo).
- Dispare perguntas em **1-2 rodadas** máx (jamais uma por vez).
- Anexe ao `02-specs/{NNN}-{slug}/protocol.md` (abra trilha vazia via `scaffold new
  feature <slug>` primeiro; vai preencher spec na Fase C).

### Fase B — Critérios de aceite (CAs)

- Transforme respostas em 5-10 CAs mensuráveis (verbo observável + critério de
  não-ambíguo).
- Premissas não respondidas viram premissas declaradas (não inferência).
- Apresente bloco único: "Aceita, ajusta ou rejeita?"

### Fase C — Plano

- Delegue ao `sdd-planner` com os CAs aprovados. Ele gera:
  - `02-specs/{NNN}-{slug}/spec.md` (ou várias specs se feature grande).
  - `01-context/plan.md` atualizado.
- Apresente tabela de trilhas + fora de escopo + premissas.
- Pergunte: **"Aprova Fase C (SIM/NÃO/Ajuste)?"** com texto literal (3 saídas).
- Não interprete `"continue"` / `"pode ir"` como aprovação — peça clareza textual.
- Ao receber `SIM` (ou variação clara de afirmativa completa), escreva
  `> APROVADO_FASE_C: <timestamp>` no `protocol.md`.

### Fase D — Execução

- Apenas após `APROVADO_FASE_C` no `protocol.md`.
- Para cada trilha criada, dispare o fluxo SDD normal:
  - `/sdd --stack=<id> feature <slug>` se há contrato; ou
  - `/sdd-feature --stack=<id> <slug>` se escopo simples sem decisão em aberto.
- Após todas as trilhas, sugira: `/tests-release --stack=all` + `/generate-architecture
  --stack=all`.

## Limitação

- O fluxo pode ser interrompido a qualquer momento pelo usuário (abra um novo prompt
  ou aborte com "cancela").
- Delta entre "continue" e "aprovo" é crítico — se você não tem certeza do que o
  usuário quis dizer, pergunte de novo. Custo de uma rodada extra << custo de
  implementação baseada em falso-aprovação.

## Não faça

- Não execute implementação antes de `APROVADO_FASE_C` no protocol.
- Não escreva código de aplicação diretamente neste command — delegue ao SDD normal.
- Não invente respostas para lacunas na Fase A — vire premissa declarada na B.
- Não pule fases mesmo que "óbvio" — a aprovação implícita é exatamente o que torna o
  plano auditável caso algo dê errado.