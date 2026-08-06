---
description: Pipeline end-to-end — carrega requisitos do documento informado, gera plano SDD e abre trilhas em `02-specs/` ordenadas por dependência técnica. Delega a `requirements-reader` seguido de `sdd-planner`. Resultado: `01-context/requirements.md` + `01-context/plan.md` + várias `02-specs/{NNN}-{slug}/spec.md`.
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

## Condução

1. `$ARGUMENTS`:
   - `<file>` (obrigatório): caminho do documento-fonte.
   - `--epic=<ID>` (opcional): somente aquele epic vira trilhas.
   - `--prioridade=<alta|media|baixa>` (opcional): só RF/US desta prioridade.
   - `--strict` (opcional): gate doctor bloqueia se score <80 (default <50).
   - `--migration` (opcional): zero US/RF não bloqueia; `context: migration`.
2. **Passo 1 — Carregamento:** delegue ao agente `requirements-reader` com `<file>`.
   - Receba recibo com contagens + `health` (heurística inicial do reader; não veredito).
   - Se ara parse falhou (`pdftotext` ausente, PDF escaneado, docx corrompido), **pare**
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
4. **Passo 3 — Plano:** delegue ao agente `sdd-planner`:
   - Passa filtro (epic/prioridade) oriundos de `$ARGUMENTS` se presentes.
   - Recebe recibo com trilhas criadas, dependências, premissas.
5. **Apresente ao usuário em uma rodada só:**
   - Trilhas abertas (`02-specs/NNN-*/spec.md`) — uma linha cada.
   - Ordem sugerida + dependências.
   - Premissas assumidas que precisam confirmação.
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
- Não gera `docs/architecture/` — isso é `/generate-architecture`, após decisões terem
  assentadas nas trilhas.