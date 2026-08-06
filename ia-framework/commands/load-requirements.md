---
description: Carrega um documento de requisitos (.docx/.pdf/.md/.txt) e persiste como `01-context/requirements.md` via `requirements-reader`, seguido de health-check via `requirements-doctor`. Sempre apresenta relatório; pergunta continuar/resolver se score ≥50 (ou ≥80 com --strict), bloqueia mandatoriamente sem perguntar se <50. Serve como passo 1 de `/plan-from-requirements` ou como carregamento isolated.
args: <file> [--strict]
---

Carrega um documento de requisitos externo e estrutura-o como memória de produto em
`01-context/requirements.md`.

## Quando usar

- O usuário tem um .docx/.pdf/.md/.txt com requisitos e quer convertê-lo em algo que as
  trilhas SDD possam consumir.
- Antes de `/plan-from-requirements` (que orfana resulta este command como step 1).
- Refresh de requisitos após nova versão do documento-fonte (reextrai nele).

## Quando NÃO usar

- Já tem `01-context/requirements.md` atualizado e só quer gerar plano → use
  `/plan-from-requirements` direto (pula a extração).
- Para usuário redigir requisitos à mao → basta `Edit` direto no arquivo.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se arquivo `<file>` é `.pdf` e `pdftotext` ausente no PATH, pergunte
> "rodar `/setup-tooling --pdftotext` chained?" — extrair PDF depende disso.

## Condução

1. `$ARGUMENTS` deve trazer o caminho do arquivo (relativo ao monorepo). Confirme:
   - Existe na extensão esperada? (`.md`/`.txt`/`.docx`/`.pdf`)
   - Se ausente, pergunte em uma rodada.
2. Garanta que a árvore SDD existe:
   ```
   pwsh skills/scaffold.ps1 init <SDD_ROOT>     # se não existe
   ```
3. Delegue ao agente `requirements-reader`:
   - Script: `pwsh -NoProfile -ExecutionPolicy Bypass -File skills/requirements/extract.ps1 <file>`
     (Linux/WSL: `bash skills/requirements/extract.sh <file>`)
   - Passo a passo: extrair texto → calcular hash SHA-256 → normalizar no template →
     preencher front-matter (`source`, `extracted`, `hash`, `kpis.health`).
4. Receba JSON recibo do agente. Apresente ao usuário em uma rodada:
   - Resumo por seção (n epics, m features, p US, q RF, r RNF).
   - Lacunas etiquetadas `[AMBIGUO]`/`[CONFLITO]`/`[AUSENTE]`/`[INFERIDO]`.
5. **Health check (gate)**: dispare o agente `requirements-doctor` no
   `01-context/requirements.md` recém-persistido (sem `--no-save`; persiste snapshot
   versionado `requirements-health/vNNN-<timestamp>.md`).
   - Apresenta relatório completo ao usuário (sempre).
   - **Regra de interação**:
     - score <50 (ou <80 se `$ARGUMENTS` contiver `--strict`): `blocked` → **NÃO
       pergunta** — aborta; instrui editar documento-fonte e re-rodar `/load-requirements`.
     - score 50+ (ou ≥80 com `--strict`): apresenta e **pergunta** ao usuário
       `"Continuar [1] | Resolver pendências [2]"`.
       - `[1] Continuar`: command termina OK; usuário pode seguir para
         `/plan-from-requirements` ou outro command.
       - `[2] Resolver pendências`: aborta; printa lista de findings + recomendações;
         usuário edita documento-fonte e re-roda `/load-requirements`.
6. Se abortou no passo 5: não persista alterações adicionais no `requirements.md`
   (reader já escreveu — é OK; doctor adicionou kpis; mantém auditoria). O sonho correto
   quando usuário escolhe `[2]` é editar o **documento-fonte** externo e re-rodar
   `/load-requirements` inteiro (re-extração com hash fresco). NUNCA edite `requirements.md`
   manualmente para consertar findings — correção é na fonte.

## Fallback gracisoo

- `pdftotext` ausente → script devolve instructivo. Exiba dica:
  ```
  Windows:  choco install poppler   ou   winget install oschwartz12612.Poppler
  macOS:    brew install poppler
  Linux:    apt install poppler-utils
  ```
  Não instale nada sem pedir.
- PDF escaneado (saída < 100 chars) → sugira `ocrmypdf input.pdf output.pdf` e reingira.
- `.docx` corrompido → health `red`, reporte.

## Saída esperada

- `01-context/requirements.md` atualizado (ou confirmado igual = diff vazio).
- `01-context/requirements-health/vNNN-<timestamp>.md` snapshot versionado (+ `INDEX.md` atualizado).
- `kpis.health`/`kpis.last_check`/`kpis.last_score` no front-matter do `requirements.md`.
- Next pipeline sugerido: `/plan-from-requirements` para gerar trilhas (se doctor não
  bloqueou).

## Limitação

Não decide arquitetura nem gera spec/trilha. Só estrutura o documento-fonte em memória.