---
description: Pipeline end-to-end — carrega requisitos do documento informado, gera plano SDD e abre trilhas em `02-specs/` ordenadas por dependência técnica. Delega a `requirements-reader` seguido de `sdd-planner`. Se existir protótipo de telas (`01-context/prototype/`), usa suas partes (P-NNN) como fonte das trilhas frontend e os DTOs do mock como contrato obrigatório das trilhas backend. Resultado: `01-context/requirements.md` + `01-context/plan.md` + várias `02-specs/{NNN}-{slug}/spec.md`.
args: <file> [--epic=<ID>] [--prioridade=<alta|media|baixa>]
---

Pipeline de carga + plano em uma invocação.

## Quando usar

- Documento de requisitos ainda não carregado OU pode estar desatualizado, e se quer o
  plano de trilhas SDD de saída imediato.
- Em estudo greenfield com `.docx`/`.pdf` de produto.

## Quando NÃO usar

- Requisitos já carregados e atualizados → use `/generate-plan` (não existe ainda; rode o
  `sdd-planner` via o agente direto — recomende adicionar command depois).
  Workaround: `/load-requirements` em PATH existente (idempotente) seguido do `/sdd` por
  trilha.
- Apenas documentação de arquitetura → `/generate-architecture`.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se arquivo `<file>` ausente em `req/` (path informado via args), sugira
> `/req-add <file>` chained antes de prosseguir.
>
> Extra protótipo: verifique `01-context/prototype/plan.md`. Se existir, informe que o
> protótipo será usado como **fonte de UX/UI (partes `P-NNN`) e de contrato de API (DTOs
> do mock)** — ver `skills/prototyping/references/feeding-sdd.md`.

## Condução

1. `$ARGUMENTS`:
   - `<file>` (obrigatório): caminho do documento-fonte.
   - `--epic=<ID>` (opcional): somente aquele epic vira trilhas.
   - `--prioridade=<alta|media|baixa>` (opcional): só RF/US desta prioridade.
   - `--strict` (opcional): gate doctor bloqueia se score <80 (default <50).
   - `--migration` (opcional): zero US/RF não bloqueia; `context: migration`.
2. **Passo 1 — Carregamento:** delegue ao agente `requirements-reader` com `<file>`.
   - Receba recibo com contagens + `health` (heurística inicial do reader; não veredito).
   - Se o parse falhou (`pdftotext` ausente, PDF escaneado, docx corrompido), **pare**
     e oriente o usuário.
3. **Passo 2 — Gate health-check:** dispare o agente `requirements-doctor` no
   `01-context/requirements.md` recém-persistido (sem `--no-save`):
   - Apresenta **sempre** relatório completo ao usuário.
   - **Regra de interação**:
     - score <50 (default) ou <80 (com `--strict`): `blocked` → **NÃO pergunta** —
       aborta o `sdd-planner`; instrui editar o documento-fonte e re-rodar
       `/load-requirements` ou este command desde o início.
     - score 50+ (default) ou ≥80 (com `--strict`): `needs_revision` ou `healthy` →
       **PERGUNTA** ao usuário `"Continuar [1] | Resolver pendências [2]"`.
       - `[1] Continuar` → segue para Passo 3.
       - `[2] Resolver pendências` → aborta; printa findings + recomendações.
   - Migration override: se `$ARGUMENTS` contiver `--migration` e zero US/RF, doctor
     não bloqueia por auto-block; `verdict: needs_revision` mesmo score ≥80 (user decide
     continuar).
4. **Passo 2.5 — Decisão de protótipo (só se existir):** quando
   `01-context/prototype/plan.md` existir, pergunte em **uma rodada só**:
   ```
   Protótipo de telas encontrado (N partes P-NNN):
     [1] Reusar como fonte de trilhas frontend + contratos (default)
     [2] Ignorar — planejar do zero
     [3] Requisitos mudaram muito → rodar /prototype-screens antes
   ```
   - `[1]` → segue para o Passo 3 com `prototype: true`.
   - `[2]` → segue para o Passo 3 com `prototype: false` (trilhas frontend do zero).
   - `[3]` → aborte e delegue `/prototype-screens`; retome quando concluído.
   Drift (RF/US novo sem parte ou parte sem RF) **não bloqueia** — vira lacuna/premissa
   no plano (ver `skills/prototyping/references/feeding-sdd.md` §drift).
5. **Passo 3 — Plano:** delegue ao agente `sdd-planner`:
   - Passa filtro (epic/prioridade) oriundos de `$ARGUMENTS` se presentes.
   - Passa `prototype: true|false` + caminho de `01-context/prototype/` quando `true`.
   - Recebe recibo com trilhas criadas, dependências, premissas — incluindo quais trilhas
     frontend derivaram de `P-NNN` e quais contratos backend vieram dos DTOs do mock.
6. **Apresente ao usuário em uma rodada só:**
   - Trilhas abertas (`02-specs/NNN-*/spec.md`) — uma linha cada.
   - Ordem sugerida + dependências.
   - Premissas assumidas que precisam confirmação.
   - Quando protótipo reusado: lista de partes `P-NNN` consumidas e contratos backend
     herdados do mock (e eventuais lacunas de drift).
   - Próximo passo sugerido: rodar `/sdd --stack=<id> <NNN> <slug>` em cada trilha.

## Saída esperada em disco

```
01-context/
  requirements.md                              # step 1
  requirements-health/vNNN-<timestamp>.md       # step 2 gate
  requirements-health/INDEX.md                  # cache de auditoria
  plan.md                                        # step 3
02-specs/
  001-<slug>/spec.md    # uma por feature
  002-<slug>/spec.md
  ...
```

Se gate aborted (`blocked` ou usuário escolheu `[2] Resolver`), `plan.md` e `02-specs/`
**não** são criados. Reexecutar o command após corrigir `req/<file>`.

## Limitação

- PDFs escaneados e `.docx` corrompidos param o pipeline na carga (erro instructivo).
- Premissas marcadas em `requirements.md` como `[AMBIGUO]` viram premissas declaradas no
  plano; o usuário decide revisá-las antes de iniciar implementação.
- Protótipo desatualizado (drift) vira lacuna/premissa no plano — o fluxo **não**
  re-prototipa automaticamente; o usuário decide (`[3]` no Passo 2.5 ou
  `/prototype-screens` depois).
- Não gera `docs/architecture/` — isso é `/generate-architecture`, após decisões terem
  assentadas nas trilhas.