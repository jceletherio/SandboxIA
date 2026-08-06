# Referência — as 5 fases do SDD Enxuto (multi-stack)

Variante multi-stack do fluxo SDD de referência. Aplica-se a qualquer stack listada em
`ia-framework/STACK.md`. Os detalhes específicos de cada stack vivem em
`skills/stacks/<stack>/references/`.

| Fase | Produz | Fecha quando |
| ---- | ------ | ------------ |
| 1. Contexto | mapa curto (≤ 20 linhas) de arquivos/regiões + ambiguidades em bloco | você sabe onde mexer e em qual stack |
| 2. Spec + Tarefas | `02-specs/{NNN}-{slug}/spec.md` (comportamento alvo, contratos tocados, tarefas, fora de escopo) | as tarefas são executáveis sem adivinhar |
| 3. Implementação | código + um commit convencional por task | as tarefas da spec estão feitas e a suíte existente passa |
| 4. Review + Testes | `verdict: ready \| blocked` com evidência `arquivo:linha` | comportamento alvo bate com o código |
| 5. Report | decisões não óbvias + achados fora de escopo | a próxima sessão retoma sem ler o diff |

## Fase 1 — Contexto

- Leia `STACK.md` para saber qual stack rege a região tocada.
- Leia `01-context/`. Localize regiões com `grep -n` / `scaffold.<ps1|sh> context <refs>`,
  depois `Read` com `offset`. **Grep antes de ler.**
- Entregue ≤ 20 linhas: `arquivo → região → o que muda ali`.
- Ambiguidades viram perguntas em **bloco** (uma rodada só). Uma pergunta bloqueia só o
  que depende dela; o resto segue.
- Não escreva código nem spec aqui.

## Fase 2 — Spec + Tarefas

Um arquivo só com quatro seções nesta ordem:

1. **Comportamento alvo** — o que muda para quem usa (5–8 bullets).
2. **Contratos tocados** — assinatura nova/alterada com o tipo. Inclua caminho de erro.
3. **Tarefas** — ordenadas, executáveis, cada uma com arquivo alvo.
4. **Fora de escopo** explícito.

Pergunta ainda sem resposta → **premissa assumida** nomeada como premissa. Nada de
`[PENDENTE]` solto: ou premissa declarada, ou fora de escopo.

## Fase 3 — Implementação

- Execute na ordem da spec. Uma task por `<stack>-implementador` quando o escopo for isolável.
- **Paralelo só entre tasks com arquivos disjuntos.** Mesmo arquivo → sequencial.
- Um commit convencional por task (`shared/git-conventions.md`).
- Problema fora do escopo vira anotação para a fase 5, nunca conserto no meio.
- Respeite as regras duras da stack em `skills/stacks/<stack>/references/`.

## Fase 4 — Review + Testes

Delegue ao agente `reviewer` (cross-stack) — ele lê `STACK.md`, confere o comportamento
alvo contra o código com evidência `arquivo:linha`, e roda a suíte de testes **existente**.

- `verdict: "ready"` só se nenhum item ficou de fora e a suíte está verde.
- Teste novo só onde lógica é pura e erro passa silencioso (validação, parser, cálculo,
  fila). Sem teste de UI/e2e, sem meta de cobertura.
- Bug-fix exige teste de regressão que reproduz o bug antes do fix.

## Fase 5 — Report

- **Decisão não óbvia + a razão** (parágrafo cada) — é o que vira memória.
- **Achados fora de escopo** específicos o suficiente para virar task.
- Atualize `01-context/` só quando arquitetura, contrato público ou mapa de onde as coisas
  estão mudou — delegue ao `context-curator`.
- ADR em `03-decisions/` **só** para decisão arquitetural irreversível.

## Regras gerais

- Contexto antes de código; spec antes de tarefa.
- Ambiguidade encontrada no meio da implementação volta para a spec — não se decide no código.
- `01-context/` desatualizado é pior que nenhum.
- Stack do comando = stack do código tocado. Não misture convenções de stacks diferentes na
  mesma spec; se a integração cross-stack for o tema, abra uma spec por ponte.