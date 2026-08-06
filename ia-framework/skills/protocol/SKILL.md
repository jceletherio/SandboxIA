---
name: protocol
description: Protocolo de aprovação em 4 fases (A→B→C→D) para planos a partir de prompt curto, sem documento de requisitos. Perguntas → Critérios de aceite → Plano → Execução. Nada é implementado antes da sua aprovação explícita da Fase C. Anexa log de protocolo em `02-specs/{NNN}-{slug}/protocol.md` para auditoria. Reutilizado por `/plan-from-prompt`.
---

# Protocolo de aprovação 4 fases

Para entradas curtas (prompt livre, sem `.docx`/`.pdf`), o `sdd-planner` não tem lastro
implícito em documento externo. Este protocolo preenche essa lacuna com **aprovação
humana iterativa** — o usuário valida cada marco antes do próximo.

## Fases

```
A: Perguntas      → agente levanta lacunas no prompt e dispara perguntas em bloco
B: CAs            → agente propõe critérios de aceite; usuário aprova/rejeita/ajusta
C: Plano          → agente escreve `02-specs/{NNN}-{slug}/spec.md` + `plan.md`; aprova
D: Execução       → só após "Fase C aprovada", dispara implementadores SDD
```

## Regra dura

> 🚫 **Sem implementação antes de "Fase C aprovada".** Se o usuário disser "pode ir",
> "continua", "ágil" ou equivalente vago, isso **NÃO** é aprovação explícita da Fase C.
> Interprete como skip voluntário das fases anteriores e **peça confirmação textual
> explícita da Fase C** antes de iniciar implementação.

## Fase A — Perguntas

**Objetivo**: levantar o que falta saber para não alucinar. Antes de gerar spec e plano,
investigue as lacunas que você teria assumido como premissa.

### Comportamento do agente

1. **Leia `ia-framework/STACK.md`** para stacks ativas (pergunta stack se a descrição é
   ambígua entre backend/banco).
2. **Leia `project_sdd/INDEX.md`** — pode já haver contexto relevante.
3. **Leia a descrição curta** e identifique lacunas:
   - **Negócio**: o que é MVP? quem são os usuários? qual jornada crítica?
   - **Stack**: backend qual? BD qual? auth exists do zero  ou integrar a SSO?
   - **NFRs**: há requisito de latência, SLA, compliance (LGPD/PCI)?
   - **Telas**: há telas já feitas (link/screens/) ou_STREAM livre?
   - **Roadmap**: o que explicitamente **não** é desta release?
4. **Use `AskUserQuestion`** (ou cole no chat se não está com tool) — em **1-2 rodadas**
   no máximo; nunca uma pergunta por vez. Listar saídas como *"A1, A2, A3" — preencha o
   que souber; pule o que não for relevante para o escopo.*
5. **Não faça** perguntas sobre implementação (ex.: "usa RxJS ou signals?"); são
   questões arquiteturais que cabem ao arquiteto da stack na fase de plano.

### Saída da Fase A

- Lista β agrupada de perguntas (id + categoria + texto).
- Anexar ao `02-specs/{NNN}-{slug}/protocol.md` (crie a spec.empty + protocol.md).
- Apenas após OUvir todas as respostas OU mensagem do usuário "faça o melhor":
  vá à Fase B.

## Fase B — Critérios de aceite

**Objetivo**: cada CA é um bullet mensurável que o `reviewer` depois confere contra o
código com `arquivo:linha`.

### Comportamento

1. Transforme o prompt + respostas da Fase A em **5-10 CAs** claros:
   - Cada CA começa com verbo observável: *"Sistema deve ..."*, *"Como X, ..."*
   - Cada CA tem critério de **não-ambíguo** (ex.: *"checkout p95 ≤ 2s"*, não *"rápido"*).
2. Apresente em bloco único ao usuário: *"Aceita, ajusta ou rejeita?"*
3. Normalize as alterações do usuário; reexiba (versão final).
4. **Anexe** versão final ao `protocol.md`.

### Saída da Fase B

- Lista numerada de CAs (CA-1 ... CA-N).
- Toda premissa assumida (do que ficou ambíguo) declarada e nomeada como premissa.
- É OK falhar aqui: se o usuário disser "não, isso é outra feature", peça descrição
  reescrita e volte à Fase A; não force.

## Fase C — Plano

**Objetivo**: `02-specs/{NNN}-{slug}/spec.md` preenchida com CAs + premissas + tarefas +
fora de escopo + `01-context/plan.md` atualizado.

### Comportamento

1. **Delegue ao `sdd-planner`**: recebe os CAs aprovados e a descrição curta; gera:
   - `02-specs/{NNN}-{slug}/spec.md` (ou várias se feature grande — uma spec por
     unidade coesa).
   - `01-context/plan.md` atualizado com nova trilha ingressada.
2. **Apresente ao usuário**:
   - Resumo da spec (bullets do "Comportamento alvo").
   - Tabela de tarefas ordenadas.
   - Fora de escopo explícito.
   - Premissas assumidas.
3. **Pergunte**: `"Aprova Fase C (SIM/NÃO/Ajuste)?"` — texto literal com as três saídas.
4. **Não interprete "continue" como aprovação.** Especificamente: o usuário deve escrever
   `"SIM"` ou `"aprovado"` (qualquer variação clara de afirmativa completa) para
   iniciar Fase D. `"Ajuste"` → revisar; `"NÃO"` → abortar com recibo.

### Saída da Fase C

- `spec.md` finalizada.
- `plan.md` atualizado.
- `protocol.md` com a string `> APROVADO_FASE_C: <timestamp>` anotada.

## Fase D — Execução

**Objetivo**: dispara implementadores por trilha.

### Comportamento

1. Apenas após `protocol.md` confirmar `APROVADO_FASE_C`.
2. Para cada trilha criada: rode `/sdd --stack=<id> <tipo> <slug>` ou, se a feature é
   simples, `/sdd-feature --stack=<id> <slug>`.
3. Após cada trilha completa, atualize `INDEX.md` via `context-curator` (modo update).
4. Ao final das trilhas: sugira `/tests-release --stack=all` + `/generate-architecture`.

### Saída da Fase D

- Log de execução no `protocol.md` de cada spec.
- Track dos verdict do `reviewer` em cada spec (conferido por `arquivo:linha`).

## Log de protocolo (`02-specs/{NNN}-{slug}/protocol.md`)

```md
# Protocolo — {NNN}-{slug}

> Anexado automaticamente para auditoria. Nao edite a mao; o orquestrador do command
> escreve aqui.

## Prompt inicial
"<descrição curta original>"

## Fase A — Perguntas
- A1 (negócio): ... → resposta do usuário
- A2 (stack): ... → resposta

## Fase B — Critérios de aceite (versão final aprovada)
- CA-1: ...
- CA-2: ...

## Fase C — Plano (versão final aprovada)
> APROVADO_FASE_C: 2026-08-05 15:32 UTC

- Trilhas criadas:
  - 02-specs/001-orders-api/spec.md
  - 02-specs/002-orders-ui/spec.md

## Fase D — Execução
- 001 orders-api: implementado, verdict ready (2026-08-05)
- 002 orders-ui: implementado, verdict ready (2026-08-06)
```

## Limitação

- Se o usuário respondeu à Fase A com um pedido de mudança (ex.: *"na verdade quero
 钣金com login social"*), interprete como **novo prompt** — retorne à Fase A com o
  prompt revisado; não force continua	da fase B.
- Se o usuário pede abortação (qualquer momento): escreva `> ABORTADO: <timestamp> -
  <razao>` no `protocol.md` e pare. Mantenha a spec/slug aberta para reprocesso futuro.

## Não faça

- Não invente respostas na Fase A — premissas viram premissas, não respostas inferidas.
- Não pule Fase B mesmo se 1-2 CAs forem "óbvios" — pergunte "é tudo?" de forma compacta.
- Não execute Fase D sem `APROVADO_FASE_C` no protocol.md.
- Não crie código de aplicação diretamente neste skill — delegue a `<stack>-implementador`
  via `/sdd` ou `/sdd-feature` na Fase D.