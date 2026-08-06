---
description: Conduz o fluxo SDD Enxuto multi-stack completo — 5 fases (Contexto → Spec+Tarefas → Implementação → Review+Testes → Report). Seleciona a skill/agent por stack via ia-framework/STACK.md (ou via argumento --stack=<id>). Use quando há decisão em aberto, contrato que outra sessão consome, ou mais de ~3 arquivos.
args: [--stack=<id> <tipo> <slug>]
---

Invoque a skill da stack escolhida e conduza as 5 fases do SDD Enxuto.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado (≥1 `- **<stack>**` em seções) e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.

## Como escolher a stack

1. Se `$ARGUMENTS` contém `--stack=<id>` (ex.: `--stack=spring`), use-a.
2. Senão, leia `ia-framework/STACK.md`. Se houver mais de uma stack ativa e o pedido toca
   mais de uma, abra uma spec por stack (não misture convenções). Se toca só uma, use-a.
3. Em caso de backend multi-stack ativa (NodeJS+Spring+Go) e pedido ambíguo, pergunte em
   bloco.

## Pipeline equivalente no orquestrador

`SDD Enxuto` (categoria `sdd-complexo`).

`$ARGUMENTS` pode trazer `--stack=<id> <tipo> <slug>`, com `<tipo>` ∈
`feature | bug-fix | investigation | doc-update` (default `feature`). Se `--stack` ausente,
inferirá do manifesto. O que faltar, pergunte — em uma rodada só.

## Quando usar este comando

- há decisão de produto ou de arquitetura em aberto;
- a mudança altera contrato que outra parte do sistema (ou outra stack) consome;
- são mais de ~3 arquivos, ou o escopo ainda não está fechado.

Se nada disso valer, o comando certo é `/sdd-feature` (escopo já claro) ou `/sdd-bug-fix`
(defeito pontual). Se o foco é arquitetura pura, `/sdd-arquitetura`. Se é only review de
segurança, `/sdd-seguranca`. Para pedidos curtos sem documento de requisitos, prefira
`/plan-from-prompt` (protocolo de aprovação em 4 fases antes de executar).

## Abrindo a trilha

```
pwsh skills/scaffold.ps1 new <tipo> "" <slug>
# ou: bash skills/scaffold.sh new <tipo> "" <slug>
```

Se a árvore SDD ainda não existe: `pwsh skills/scaffold.ps1 init <SDD_ROOT>` antes. Se
`01-context/` está vazio → rode `/sdd-context` primeiro; sem contexto real o fluxo inventa
regra.

## Fases (resumo — ver `skills/stacks/<stack>/SKILL.md` e `skills/shared/flow.md`)

1. **Contexto** — mapa de arquivos/regiões + perguntas em bloco.
2. **Spec + Tarefas** — `02-specs/{NNN}-{slug}/spec.md` (comportamento alvo, contratos
   tocados, tarefas por camada stack, fora de escopo, premissas).
3. **Implementação** — delegue ao agente `<stack>-implementador` por tarefa (paralelo só
   entre arquivos disjuntos); um commit por task. O implementador sugira `/test-add
   functional|integration` quando a tarefa cobre componente/endpoint isolável.
4. **Review + Testes** — delegue ao agente `reviewer` (cross-stack): confere bullets contra
   o código com evidência + roda suíte existente. Para variante `bug-fix`, disparar
   `/tests-regression` para capturar o teste que reproduz (red) antes do fix.
5. **Report** — decisões não óbvias + achados fora de escopo; atualize `01-context/` se
   arquitetura/contrato/mapa mudou (delegue ao `context-curator` em modo update). **Ao
   final do prompt**, sempre sugira: "Para cobertura de sistema/aceitação/E2E, rode
   `/tests-release --stack=<id>` antes do release; persiste plano em
   `docs/testing/test-plan-<stack>.md`. Se decisões arquiteturais maduras, rode
   `/generate-architecture --stack=<id|all>` para snapshot em `docs/architecture/`."