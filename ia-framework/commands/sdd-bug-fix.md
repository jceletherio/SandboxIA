---
description: Defeito pontual — reproduzir, corrigir a causa-raiz, teste de regressão. Implementação → Report. Seleciona stack via ia-framework/STACK.md ou --stack=<id>. Absorve ajuste trivial de UI/copy/tooltip.
args: [--stack=<id> <slug>]
---

Defeito pontual ou ajuste trivial: 1–2 arquivos, sem regra nova, sem decisão de produto.
Absorve ajuste cosmético (copy, tooltip).

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.

## Como escolher a stack

1. Se `$ARGUMENTS` contém `--stack=<id>`, use-a.
2. Senão, infera da raiz touched via `ia-framework/STACK.md` (ver `/sdd-feature` para
   tabela raiz→stack). Se ambíguo, pergunte.

## Pipeline equivalente no orquestrador

`Fix Rápido` (categoria `fix-rapido`).

## Fases

**Implementação → Report**. Sem spec, sem fase de contexto separada — o contexto é o
próprio sintoma.

1. Slug em `$ARGUMENTS` (kebab-case); se ausente, pergunte.
2. Carregue `skills/stacks/<stack>/references/arquitetura.md` para convenções da stack.
3. **Reproduza e capture o sintoma como teste de regressão** — delegue a
   `/tests-regression <slug>` quando há lógica envolvida. O `regression-author` escreve
   teste que **reproduz o bug** (red) e devolve `red_confirmed: true`. Sem testar red
   primeiro, o "fix" pode ser coincidência — falácia de regressão clássica. Ajuste
   cosmético (copy, tooltip) dispensa este passo.
4. Ache a causa-raiz com `grep -n` e leia com `offset`. Corrija a causa, não o sintoma.
   Use `<stack>-implementador` para aplicar o fix — limita-se ao escopo cirúrgico.
5. **Confirme green**: rode `/tests-run --level=regression --stack=<id>` para validar que
   o teste de regressão agora passa. Sem isso, o fix não fechou o sintoma — `verdict` vira
   `blocked` na fase de review.
6. Rode a suíte completa existente via `/tests-run --stack=<id>` para assegurar que
   vizinhanças não quebraram.
7. Report: a causa-raiz em um parágrafo (é o que evita o bug voltar) + caminho do teste
   de regressão + achados fora de escopo.

Escale para `/sdd` se a causa-raiz revelar decisão de produto, se o fix exigir mudar um
contrato, ou se o defeito for sintoma de um problema de arquitetura.