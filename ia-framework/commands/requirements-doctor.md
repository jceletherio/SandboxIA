---
description: Verifica a saúde do documento de requisitos (01-context/requirements.md ou arquivo externo). Score 0-100 em 8 dimensões; sempre apresenta relatório; score <50 bloqueia mandatoriamente sem perguntar, score 50+ pergunta continuar/resolver. Persiste relatório versionado em requirements-health/vNNN-<timestamp>.md. Gate pré-planejamento do /plan-from-requirements; útil também como stand-alone após /load-requirements.
args: [<file-or-path>] [--strict] [--migration] [--no-save]
---

Verifica qualidade do documento de requisitos antes de planejar ou desenvolver.

## Quando usar

- Após `/load-requirements` — confirmar que extração resultou em doc saudável.
- Antes de `/plan-from-requirements` — gate de bloqueio pré `sdd-planner`.
- Stand-alone: periodicidade de auditoria ("será que meu requisito.docx atualizado
  ainda está saudável?").
- Pré-release: histórico completo de checagens em `requirements-health/` para auditória.

## Quando NÃO usar

- Documento ainda não carregado em `01-context/requirements.md` e você quer apenas
  carregar (sem checar) — rode `/load-requirements` (que internamente invoca o doctor).
- Apenas correção pontual — edite o documento-fonte e re-rode `/load-requirements`
  para refresh.
- Bug pontual sem requisitos (`/sdd-bug-fix`) — sem gate.
- Prompt curto sem documento (`/plan-from-prompt`) — sem gate (descrição breve).

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se alvo é arquivo externo `.pdf` e `pdftotext` ausente, sugira
> `/setup-tooling --pdftotext` chained antes.

## Condução

1. `$ARGUMENTS`:
   - Default sem args: checa `project_sdd/01-context/requirements.md`.
   - `<file-or-path>`: extrai via `requirements-reader` em temp (não persiste) se for
     arquivo externo `.docx/.pdf/.md/.txt`; se for path para `requirements.md` existente,
     checa direto.
   - `--strict`: threshold de bloqueio vira <80 (default <50).
   - `--migration`: zero US/RF não auto-bloqueia; `context: migration`.
   - `--no-save`: não persiste relatório nem atualiza kpis (modo diagnóstico — útil em CI
     ou testes).

2. Delegue ao agente `requirements-doctor`:
   - Carrega `skills/requirements/references/health-check.md` + `formats.md`.
   - Avalia 8 dimensões (front-matter, visão, epics, US, RF, RNF, lacunas, coerência).
   - Score 0-100; verdict `healthy` (≥80) | `needs_revision` (50-79) | `blocked` (<50, ou
     auto-block conditions, ou `--strict` + <80).
   - Persiste `requirements-health/vNNN-<timestamp>.md` + atualiza `INDEX.md` +
     `kpis.health` no `requirements.md` (se não `--no-save`).
   - Devolve JSON com findings, recommendations e snapshot path.

3. **Apresenta relatório ao usuário** — sempre, mesmo se `healthy`:

```
requirements-doctor → <source>
score: <score>/100  health: <green|yellow|red|blocked>  verdict: <healthy|needs_revision|blocked>  context: <greenfield|migration>
findings: <N> (<critical> critical, <high> high, <medium> medium, <low> low)

  <SEVERITY> <id> <descrição curta>
            evidence: <arquivo:linha>
            fix: <ação recomendada>

snapshot: <path ou "não salvo (--no-save)">
```

4. **Regra de interação** (conforme aprovado):

| Score | Verdict | Comportamento |
|---|---|---|
| <50 (default) ou <80 (com --strict) | `blocked` | Apresenta relatório. **NÃO pergunta** — bloqueio mandatório. Aborta o próximo command. |
| 50-79 (default) ou 80+ (com --strict) | `needs_revision` (sem --strict) | Apresenta relatório. **PERGUNTA**: `[1] Continuar / [2] Resolver pendências`. `[1]` → command termina OK. `[2]` → aborta; usuário edita o documento-fonte e re-roda `load-requirements` ou o command desde o início. |
| ≥80 (default) | `healthy` | Apresenta relatório. **PERGUNTA** (igual 50-79) — usuário decide mesmo se saudável (descobriu detalhe? quer ajustar? padrão). |

5. **Quando aborta (`blocked` ou `[2]`)**: lista findings bloqueantes no topo do recibo
   e orientação clara:

   ```
   BLOQUEIO — próximos passos abortados.
   
   Para resolver:
   1. Edite o documento-fonte original (req/<seu-arquivo>), não o requirements.md.
   2. Re-rode:
      /load-requirements <file>     # re-extrai
      /requirements-doctor          # re-checa
   3. Só então rode /plan-from-requirements para abrir trilhas SDD.
   ```

6. **Quando segue (`[1] Continuar`)**: printa confirmação e termina. Se este command foi
   invocado no pipeline `/plan-from-requirements`, o orquestrador encadeia ao
   `sdd-planner`. Se stand-alone, simplesmente termina.

## Saída esperada

- `requirements-health/vNNN-<timestamp>.md`: snapshot versionado não-overwrite.
- `requirements-health/INDEX.md`: cache de auditoria (1 linha/execução).
- Front-matter do `requirements.md` atualizado:
  ```yaml
  kpis:
    health: green|yellow|red|blocked
    last_check: <timestamp ISO>
    last_score: <score>
  ```
- Recibo compacto ao terminal/chat com tabela de findings.

## Flags

| Flag | Efeito | Default quando ausente |
|---|---|---|
| `--strict` | Bloqueio se score <80 em vez de <50 | Bloqueio se score <50 |
| `--migration` | Zero US/RF não bloqueia; `context: migration` | Perguntar usuário se zero US/RF |
| `--no-save` | Não persiste; modo diagnóstico | Sempre persiste |

## Limitação

- Read-only em código de aplicação — não edita `src/frontend/`, `src/backend/`, `src/BD/`.
- Não substitui entrevista humana — findings de CA ausentes, por ex., não tem correção
  automatizável; recomenda `ENTREVISTAR <stakeholder>`.
- Orquestrador com `AskUserQuestion` tool faculta pergunta natural; sem tool, usa stdin.

## Pipeline integrado (reiteração)

```
OPÇÃO A — Documento de requisitos completo:

  /load-requirements req/<file>
       ├─ requirements-reader persiste 01-context/requirements.md
       └─ requirements-doctor ─> score; SEMPRE apresenta; pergunta || bloqueia
                                 ↓  [1] Continuar  /  [2] Resolver
  
  /plan-from-requirements req/<file>
       ├─ requirements-reader extrai
       ├─ requirements-doctor GATE
       │     ↓ score <50 → ABORT (não pergunta)
       │     ↓ score 50+  → mostra + pergunta [1] [2]
       │             [1] → sdd-planner gera trilhas
       │             [2] → aborta
       └─ sdd-planner abre trilhas 02-specs/NNN-<slug>/spec.md + plan.md

OPÇÃO C — Prompt curto: SEM gate (plan-from-prompt segue protocolo 4-fases isolado)
```

## Não faça

- Não aborte sem mostrar relatório completo antes.
- Não pergunte continuar/resolver quando `blocked` (≤default <50; <80 com --strict).
- Não sobrescreva `requirements-health/vNNN-*.md` existentes — criar próximo número.
- Não edite `requirements.md` para "consertar" findings — correção é humana, no
  documento-fonte.
- Não rode doctor em CLI sem `Bash` tool available — se sem runtime bash/PowerShell,
  reporte "ambiente sem tooling de doctor; rode manualmente em repo local".