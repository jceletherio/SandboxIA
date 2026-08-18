---
description: Instala ferramental de runtime/devops via flags modulares. Cria o skeleton de aplicações por stack ativa (--apps), instala deps de runtime por stack (--deps), QMD local com autoindex (--qmd), pdftotext via package manager do SO (--pdftotext), pre-commit hooks (--hooks). Sem flags: pergunta interativamente quais rodar. Sempre pede confirmação explícita antes de qualquer sub-operação que mexa no sistema (lockfiles, package manager global, binary global).
args: [--apps] [--deps] [--qmd] [--pdftotext] [--hooks] [--all]
---

Setup de ferramental. Modular via flags; sempre com confirmação explícita.

## Quando usar

- Após `/init` para rodar passos específicos que você optou por pular.
- Periodicamente, quando algum deps estiver desatualizado/ausente.
- Em nova sessão resumed se `/state` acusou falta (ex.: `node_modules ausente`).
- Em novo host dev (clone de colega): `/setup-tooling --all` numa tacada só.

## Quando NÃO usar

- Em cada implementação de trilha — é uma única vez por projeto (e novamente quando
  deps mudam).
- Para instalar agentes/skills — estes vivem em `ia-framework/`, sem install.

## Condução

### Passo 1 — Interpretação de flags

- `$ARGUMENTS` contém zero ou mais flags listadas acima.
- Zero flags (sem `--`): **ENTER modo interativo** — pergunte "Quais passos rodar?"
  (multi-select via `AskUserQuestion`: apps, deps, qmd, pdftotext, hooks).
- `--all`: rodar todos os 5 (cada com confirmação própria).
- Combinar flags: `--deps --hooks` roda ambos; cada pede confirmação separada.
- Em ambientes Sem `AskUserQuestion`: printe pergunta no chat e leia próxima resposta.

Para cada sub-operação abaixo, mostre o comando real que vai rodar e pergunte "Confirmar
[Y/N]?". Se "N", skip aquele step com recibo "pulado pelo usuário".

### Passo 1.5 — Sub-operação `--apps` (scaffold de aplicações)

**Quando:** em projeto greenfield, o `/init` cria só a árvore SDD (docs) — as aplicações
reais (`src/frontend/package.json`, `src/backend/nodejs/`, etc.) precisam ser criadas antes de
qualquer implementador ou do protótipo. Este passo cria o skeleton mínimo por stack ativa.

Lê `ia-framework/STACK.md`; para cada stack ativa **sem skeleton**:

- **angular** (`src/frontend/`): se `src/frontend/package.json`/`angular.json` ausentes:
  1. Limpe resíduos estranhos da pasta (ex.: `.next/`, `node_modules/` órfãos) — mostre
     `Remove-Item` e confirme antes.
  2. `npx -y @angular/cli@latest new frontend-app --directory <temp> --standalone
     --style scss --routing --skip-git` (pasta temp porque o Angular CLI não aceita
     pasta com arquivos) e mova o conteúdo para `src/frontend/` — ou use
     `ng new frontend --directory frontend` se a pasta estiver vazia.
- **react** (`src/react/`): se `src/react/package.json`/`vite.config.ts` ausentes:
  1. `npm create vite@latest <temp> -- --template react-ts` e mova o conteúdo para
     `src/react/` (Vite não aceita pasta com arquivos; ou `npm create vite@latest . -- --template
     react-ts` em pasta vazia).
  2. Instale deps do stack: `@tanstack/react-query react-router-dom` (+ `zustand` se o
     arquiteto decidir client state cross-feature).
- **nodejs** (`src/backend/nodejs/`): se sem `package.json`:
  ```
  npm init -y
  npm pkg set type=module
  npm install --save-dev typescript @types/node vitest
  npx tsc --init
  ```
- **spring** (`src/backend/spring/`): se sem `pom.xml`/`build.gradle` — via Spring Initializr:
  ```
  curl -s https://start.spring.io/starter.tgz -d dependencies=web,data-jpa,validation \
       -d type=maven-project -d language=java -d bootVersion=3.5.x | tar -xzf - -C src/backend/spring
  ```
  (adapte ao ambiente; se `curl` indisponível, instrua o usuário a baixar de
  `start.spring.io` manualmente).
- **go** (`src/backend/go/`): se sem `go.mod`:
  ```
  cd src/backend/go && go mod init <module>
  ```
  Pergunte o nome do módulo (default: `github.com/<org>/<projeto>`).
- **postgres**: n/a (src/BD/ é só migrations SQL; sem skeleton).

Após criar, rode `/setup-tooling --deps` (ou sugira) para instalar as deps.

### Passo 2 — Sub-operação `--deps`

Lê `ia-framework/STACK.md`; para cada stack ativa:

- **angular** (`src/frontend/`):
  ```
  validade: src/frontend/package.json existe?
  if Nao existe: avise e pergunte "Rodar /setup-tooling --apps antes (cria o app Angular)? [Y/N]"
  se sim: delegue --apps (mesmo command) e retome npm install
  se nao: abort — sem package.json o npm install nao tem o que instalar
  pergunta: "Rodar `cd src/frontend && npm install`?"
  se sim: Bash → npm install (output tail ao usuário)
  ```
- **react** (`src/react/`):
  ```
  validade: src/react/package.json existe?
  if Nao existe: avise e pergunte "Rodar /setup-tooling --apps antes (cria o app React)? [Y/N]"
  se sim: delegue --apps (mesmo command) e retome npm install
  se nao: abort — sem package.json o npm install nao tem o que instalar
  pergunta: "Rodar `cd src/react && npm install`?"
  se sim: Bash → npm install (output tail ao usuário)
  ```
- **nodejs** (`src/backend/nodejs/`):
  ```
  validade: src/backend/nodejs/package.json
  if Nao existe: avise e pergunte "Rodar /setup-tooling --apps antes (cria o app Node)? [Y/N]"
  se sim: delegue --apps e retome
  se nao: abort
  pergunta: "Rodar `cd src/backend/nodejs && npm install`?"
  se sim: Bash → npm install
  ```
- **spring** (`src/backend/spring/`):
  ```
  validade: src/backend/spring/pom.xml (ou build.gradle)
  pergunta: "Rodar `./mvnw -DskipTests` (ou `./gradlew build -x test`) em src/backend/spring?"
  se sim: Bash → cd src/backend/spring && ./mvnw -DskipTests -q (ou gradlew)
  ```
- **go** (`src/backend/go/`):
  ```
  validade: src/backend/go/go.mod
  pergunta: "Rodar `cd src/backend/go && go mod tidy`?"
  se sim: Bash → go mod tidy
  ```
- **postgres**: n/a (sem runtime deps para instalar).

Idempotente: skip se `src/frontend/node_modules` já existe e `package-lock.json`/total size
confirma completo. (Heurística: `Test-Path src/frontend/node_modules/`.)

### Passo 3 — Sub-operação `--qmd`

Avisa: "QMD baixa ~2GB na primeira execução de `qmd embed`. Demora 5-15 min."

Pergunta preferência `npm | bun | npx`:
- Auto-detect prioridade: se `npm` no PATH, sugere npm (default); senão `bun`; senão `npx`
  (não instala binário global, mas é mais lento a cada `npx @tobilu/qmd ...`).

Pergunta confirma dupla: "Confirmar install de QMD + qmd init + collection adds + qmd
embed (~5-15 min, ~2GB)?"

```
npm install -g @tobilu/qmd            # preferencial
# OU bun install -g @tobilu/qmd       # se bun preferido
# sem install global se npx escolhido (user pode usar npx @tobilu/qmd ... manualmente)
qmd --version                         # confirma
qmd init                              # project-local .qmd/
qmd collection add project_sdd/01-context --name context --mask "**/*.md"
qmd collection add project_sdd/02-specs   --name specs   --mask "**/*.md"
qmd collection add project_sdd/03-decisions --name adrs  --mask "**/*.md"
qmd collection add docs/architecture       --name arch    --mask "**/*.md"
qmd collection add docs/testing           --name tests   --mask "**/*.md"
qmd context add qmd://context "Memória viva do projeto SDD"
qmd context add qmd://specs   "Trilhas SDD com spec + tarefas"
qmd context add qmd://arch    "Snapshot de arquitetura per-release"
qmd embed                            # 5-15 min
qmd status
```

Adicione `.qmd/` ao `.gitignore` se não tem.

### Passo 4 — Sub-operação `--pdftotext`

Detecta package manager no SO:
- Windows: testa `Get-Command winget`, `Get-Command choco`, em ordem.
- macOS: `Get-Command brew`.
- Linux/WSL: `Get-Command apt-get`, `apt`, `dnf`, `pacman` em ordem.

Mostra pacote e comando:

```
Detectado: winget (Windows)
Vou rodar: `winget install oschwartz12612.Poppler --silent`
(riscos:  instala binário global pdftotext + pdfinfo + pdfunite)
```

Confirmar `[Y/N]`. Se `Y`, executa via Bash.

- `winget install oschwartz12612.Poppler --silent` (Windows)
- `choco install poppler -y` (Windows, se choco disponível)
- `brew install poppler` (macOS)
- `apt-get install -y poppler-utils` (Linux/WSL)

Verifica `Get-Command pdftotext` após instalação.

### Passo 5 — Sub-operação `--hooks`

```
validade: .pre-commit-config.template.yaml existe
validade: pre-commit binary (pip install pre-commit se faltar)
```

Pergunta duas vezes:

1. "Preciso `pip install pre-commit` (você ainda não tem). Confirmar? [Y/N]"
   - Skip se já tem.
2. "Vou copiar `.pre-commit-config.template.yaml` para `.pre-commit-config.yaml` e
   descomentar blocos conforme stacks ativas (`<angular|spring|go|nodejs>`). Depois rodo
   `pre-commit install` + `pre-commit autoupdate`. Confirmar? [Y/N]"

Após confirma, executa:

```
Copy-Item .pre-commit-config.template.yaml .pre-commit-config.yaml
Edit → descomenta linhas comentadas `# - repo: local` para blocos das stacks ativas
pre-commit install
pre-commit autoupdate
```

### Passo 6 — Recibo final

```
setup-tooling →
  --apps:    frontend Angular criado | frontend React criado | backend/nodejs criado | pulado (já existia) | erro: <detalhe>
  --deps:    src/frontend/node_modules OK (instalado | já existia)
             src/react/node_modules OK (instalado | já existia)
             src/backend/nodejs/node_modules OK
  --qmd:     instalado + 5 collections + embed completo | pulado | erro: <detalhe>
  --pdftotext: instalado (winget) | já disponível | falha: <pacote manager ausente>
  --hooks:   .pre-commit-config.yaml criado + pre-commit install OK | pulado

Próximo passo sugerido:
  /load-requirements req/<file>
  /plan-from-requirements req/<file>
```

## Pré-voo

Siga `skills/shared/preflight.md`. Se `ia-framework/STACK.md` não configurado OU
`project_sdd/01-context/` ausente → pergunte "rodar `/init`?" chained. `--deps` exige
STACK.md configurado para saber onde instalar.

## Limitação

- **Não instala sem confirmar explicitamente** cada sub-operação.
- `pip`, `npm`, `winget`, `choco`, `brew`, `apt-get` devem estar no PATH previamente —
  não conseguimos bootstrapping base (instalar o apt via apt é paradoxo).
- `qmd embed` pode falhar em ambientes Sem VRAM/GPU; sugira rodar `qmd doctor` para
  diagnóstico nesses casos.

## Não faça

- Não rode sub-operação sem confirmação — cada uma mexe no sistema.
- Não passe `--yes` implícito em qualquer package install — pause sempre.
- Não skip `pre-commit autoupdate` — versões desatualizadas geram warnings annoyers.
- Não instale deps de dev (`@testing-library/angular`) separadamente — esses vêm com
  `npm install` via devDependencies de `package.json`.