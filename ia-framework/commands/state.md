---
description: Diagnóstico read-only do estado do template. Reporta o que está configurado e o que falta, com próximo passo sugerido. Não modifica nada. Use quando não souber onde está no setup, ou como "status checkpoint" antes de continuar trabalho.
---

Diagnóstico conversacional do estado do template.

## Quando usar

- Após clonar:  para ver o que falta antes do `/init`.
- Antes de qualquer command SDD:  confirma que setup está completo.
- Em sessão resumed:  reconecta-se ao projeto sem ler tudo de novo.
- Periodicamente:  health check de que ferramental não quebrou.

## Quando NÃO usar

- Para iniciar setup — rode `/init`.
- Para instalar ferramental — rode `/setup-tooling` (qualquer flag).
- Para carregar requisitos — rode `/req-add` ou `/load-requirements`.

## Condução

Não pergunte nada ao usuário. Apenas execute via `Bash`/`Read`/`Grep`:

### 1. Identidade do template

```
Read ia-framework/VERSION         → versão semver
Read ia-framework/CHANGELOG.md    → última data de changelog
```

### 2. Stacks ativas

```
grep -E '^- \*\*(angular|nodejs|spring|go|postgres)\*\*' ia-framework/STACK.md
```

Para cada stack ativa, registre nome + raiz de código (`frontend/` / `backend/<stack>/` /
`BD/`).

### 3. Árvore SDD

```
Test-Path project_sdd/01-context/       # memória viva
Test-Path project_sdd/02-specs/         # trilhas
Test-Path project_sdd/03-decisions/    # ADRs
Test-Path project_sdd/STATUS.md        # status com KPIs
Test-Path project_sdd/INDEX.md         # indice memory-curator
```

### 4. Requisitos e telas

```
Test-Path req/                         # pasta de requisitos
glob req/*.docx req/*.pdf req/*.md req/*.txt    # arquivos
Test-Path req/screens/ 
glob req/screens/*.png req/screens/*.jpg        # telas
Test-Path project_sdd/01-context/requirements.md     # carregado?
Test-Path project_sdd/01-context/screens/           # telas descritas?
```

### 5. Docs técnico / testes

```
Test-Path docs/architecture/          # snapshots
glob docs/architecture/*.md
Test-Path docs/testing/               # planos de testes
glob docs/testing/*.md
Test-Path project_sdd/01-context/requirements-health/  # histórico do doctor
glob project_sdd/01-context/requirements-health/v*.md
```

### 6. Ferramental

```
# Pre-commit hooks
Test-Path .pre-commit-config.yaml
Get-Command pre-commit           # binary no PATH?

# .gitignore
Test-Path .gitignore
grep '\.qmd/' .gitignore         # tem entrada QMD?

# QMD
Get-Command qmd                 # instalado?
Test-Path .qmd/index.yml         # project-local?

# pdftotext
Get-Command pdftotext

# Deps por stack ativa (se stack ativa)
  stack=angular: Test-Path frontend/package.json && Test-Path frontend/node_modules
  stack=nodejs:  Test-Path backend/nodejs/package.json && Test-Path backend/nodejs/node_modules
  stack=spring:  Test-Path backend/spring/pom.xml && Test-Path backend/spring/target/classes/.gitkeep
  stack=go:      Test-Path backend/go/go.mod && Test-Path backend/go/go.sum
```

### 7. Output tabular

```
=== Estado do template ===

Template:    ia-framework 1.2.0 (changelog mais recente 2026-08-05)

Stacks ativas:
  ✓ angular    — raiz: frontend/
  ✓ nodejs     — raiz: backend/nodejs/
  ✗ spring     — desativado (não listar)
  ✗ go         — desativado
  ✓ postgres   — raiz: BD/

Árvore SDD:
  ✓ project_sdd/01-context/ (6 templates)
  ✓ project_sdd/02-specs/ (3 specs)
  ✓ project_sdd/03-decisions/ (2 ADRs)
  ✓ project_sdd/STATUS.md (KPIs): 1 aberta | 0 bloqueada | 2 prontas
  ✓ project_sdd/INDEX.md (atualizado 2026-08-05)

Requisitos:
  ✓ req/ tem 1 arquivo: requisito.docx
  ✗ req/screens/ vazio
  ✓ 01-context/requirements.md carregado (score 82/100, healthy — doctor v003 2026-08-05)
  ✗ 01-context/screens/ vazio

Docs:
  ✓ docs/architecture/ (overview.md + 3 stacks)
  ✗ docs/testing/ vazio — rode /tests-release depois

Ferramental:
  ✓ .gitignore (com .qmd/)
  ✓ .pre-commit-config.yaml configurado
  ✓ pre-commit binary no PATH
  ✗ qmd não instalado — rode /setup-tooling --qmd
  ✓ pdftotext no PATH
  ✓ frontend/node_modules OK
  ✗ backend/nodejs/node_modules ausente — rode /setup-tooling --deps

=== Próximo passo sugerido ===

Sua árvore está pronta para implementação. Rode:
  /sdd --stack=nodejs feature 001 products-api

ou para adicionar requisitos:
  /req-add <caminho-do-arquivo>
```

### 8. Mensagem de "está faltando setup"

Se invariáveis mínimas de `preflight.md` faltam (não há `STACK.md` configurado OU não há
`project_sdd/01-context/`):

```
✗ Setup faltante detectado:
  - ia-framework/STACK.md é template default
  - project_sdd/01-context/ ausente

Próximo passo: rode /init para configurar tudo conversacionalmente.
```

### 9. Não pergunte — apenas reporte

Sem `AskUserQuestion`; sem abortar chain. Output é diagnóstico puro. Próximo passo é
humano (ou outro command do usuário).

## Limitação

- Output varia conforme SO detectado (Windows usa `Get-Command`, Linux/WSL usa `command
  -v`). Use Bash com `command -v` cross-platform (PowerShell aliasing de Get-Command vs
  POSIX difere mas o `Get-Command` é native em Windows; em WSL/MSYS use `command -v`).

## Não faça

- Não abra dialog com usuário — output é report-only.
- Não execute setup — apenas relata (não cria pastas, não instala deps).
- Não leia código de produção — foco em infra.
- Não summon memory-curator ou outro agente — `Read`/`Bash` direto.