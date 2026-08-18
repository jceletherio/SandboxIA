---
description: Wizard de inicialização conversacional do template. Pergunta stacks ativas, QMD, pre-commit hooks e .gitignore via chat; executa tudo via Bash sem o usuário ir ao terminal. Caminho primário para setup — alternativa ao init.ps1/init.sh. Use após clonar o repo, ou quando um command SDD detectar estado faltante e perguntar "rodar /init?".
---

Wizard de bootstrap 100% conversacional. Substitui `init.ps1`/`init.sh` quando você está
em orquestrador como opencode ou Claude Code.

## Quando usar

- Após clonar o template como base de um novo projeto.
- Quando um command SDD detecta estado faltante e dispara este `/init` emcadeado.
- Para refresh de configuração (ajustar `STACK.md`, instalar hook que ficou faltando).

## Condução

Pergunte ao usuário via `AskUserQuestion` (ou equivalente) em **1 rodada só** com 4 itens:

### 1. Stacks ativas (multi-select)

```
Ativar quais stacks?
[ ] Angular 22 (frontend) — default: sim
[ ] React 19+ (frontend) — default: não
[ ] Node.js 22+ (backend) — default: sim
[ ] Spring Boot 3.5 (backend) — default: não
[ ] Go 1.23+ (backend) — default: não
[ ] PostgreSQL 16+ (banco) — default: sim
```

Aplica defaults se usuário não especifica (`y` em tudo): Angular + Node + Postgres. Dois
frontends podem coexistir (angular + react) — cada agente fica restrito à sua raiz.

### 2. QMD (default: N)

```
Instalar QMD agora? (~2GB modelos GGUF no primeiro qmd embed)
[ ] Não (padrão) — índice curado INDEX.md cobre 99% dos usos
[ ] Sim — instalar via npm e rodar qmd init + collections + embed (5-15 min)
```

Se "Sim": pergunta preferência em sequência (auto-detect prioridade `npm` → `bun` →
`npx`).

### 3. Pre-commit hooks (default: Y)

```
Configurar pre-commit hooks (.pre-commit-config.template.yaml + pre-commit install)?
[ ] Sim (padrão) — copia template, descomenta por stack, instala
[ ] Não — posso rodar /setup-tooling --hooks depois
```

### 4. .gitignore (default: Y)

```
Criar .gitignore com entradas padrão (.qmd/, test-results/, .env, node_modules/, etc)?
[ ] Sim (padrão)
[ ] Não, já tenho um
```

## Execução (via Bash)

Conduza após receber as respostas — tudo via Bash tool do orquestrador. Sem stdin (esse
é o ponto — 100% conversacional).

### Ajustar `ia-framework/STACK.md`

Use `Read` e `Edit` (ou `Write` overwrite) em `ia-framework/STACK.md` conforme seleções.

### Criar pastas

```
New-Item -ItemType Directory -Force -Path project_sdd, docs/architecture, docs/testing, req, req/screens, examples
```

(Bash Linux/WSL: `mkdir -p project_sdd docs/architecture docs/testing req/screens examples`)

### Scaffold da árvore SDD

```
powershell -NoProfile -ExecutionPolicy Bypass -File ia-framework/skills/scaffold.ps1 init project_sdd
```

ou `bash ia-framework/skills/scaffold.sh init project_sdd`. Output copia templates de
`01-context/` e gera `STATUS.md`. O scaffold também cria as subpastas de entrada:
`01-context/screens/` (telas vision) e `01-context/prototype/{designs,review}/`
(protótipo de telas) — cada uma com `.gitkeep`.

### QMD (se confirmado)

```
npm install -g @tobilu/qmd           # ou bun install -g @tobilu/qmd
qmd --version
qmd init
# collections (apenas pastas que existem)
qmd collection add project_sdd/01-context --name context --mask "**/*.md"
qmd collection add project_sdd/02-specs   --name specs   --mask "**/*.md"
qmd collection add project_sdd/03-decisions --name adrs  --mask "**/*.md"
qmd collection add docs/architecture       --name arch    --mask "**/*.md"
qmd collection add docs/testing           --name tests   --mask "**/*.md"
qmd context add qmd://context "Memória viva do projeto SDD"
qmd context add qmd://specs   "Trilhas SDD com spec + tarefas"
qmd context add qmd://arch    "Snapshot de arquitetura per-release"
qmd embed                            # 5-15 min — avisa usuário
qmd status
```

Garanta `.qmd/` no `.gitignore`.

### Pre-commit hooks (se confirmado)

```
Copy-Item .pre-commit-config.template.yaml .pre-commit-config.yaml
```

Use `Edit` para descomentar blocos (`# - repo: local...`) conforme stacks ativas
(markers `# Angular (src/frontend/)` etc no template). Depois:

```
# Detectar pre-commit binary
pip install pre-commit          # se ausente, pergunta antes
pre-commit install
pre-commit autoupdate
```

### .gitignore (se confirmado)

Se não existe, cria via `Write` com conteúdo padrão (`skills/templates/.gitignore`
template). Se já existe, apenas garante que `.qmd/` está incluído via `Edit`.

## Pré-voo

> Veja `skills/shared/preflight.md`. Como este command É o init, ele próprio executa os
> passos; pre-flight reduz a "existe já um STACK.md configurado? Se sim, pergunte se
> reconfigure".

## Saída (recibo compacto ao chat)

```
init OK em <repoRoot>

Stacks ativas: angular, nodejs, postgres
Árvore SDD: project_sdd/ criada (01-context/ 6 templates + screens/ + prototype/, 02-specs/, 03-decisions/, STATUS.md)
QMD: instalado e indexado | pulado (rodar `/setup-tooling --qmd` depois)
Pre-commit: template copiado e hooks instalados | pulado (rodar /setup-tooling --hooks depois)
.gitignore: criado com .qmd/

Próximos passos:
  1. /req-add <caminho-do-arquivo.docx>      para copiar seus requisitos
  2. /setup-tooling --apps                     para criar o skeleton dos apps (ng new, npm init, go mod init, Spring)
  3. /setup-tooling --deps                    para instalar deps das stacks
  4. /plan-from-requirements req/<file>        para gerar plano SDD
  5. /sdd --stack=<id> <tipo> <slug>          por trilha

Em qualquer dúvida sobre estado: /state
```

## Limitação

- Em orquestradores Sem `AskUserQuestion` tool: LLM usa o chat natural para perguntar
  (uma rodada só, com as 4 perguntas; usuário responde em um bloco).
- Sem `Bash` no ambiente do orquestrador: caso raro — abort e instrua usuário a rodar
  `init.ps1` ou `init.sh` no terminal.
- `qmd embed` é pesado (5-15 min, ~2GB). Avise o usuário antes e ofereça alternativa:
  "pular por agora e rodar `/setup-tooling --qmd` depois".

## Não faça

- Não pergunte uma decisão por vez (1 rodada só para os 4 itens iniciais).
- Não abra `Bash` para `pip install pre-commit` sem mostrar o comando antes (side effect
  global).
- Não sobrescreva `STACK.md` existente sem perguntar "Reconfigurar SUAS stacks?" — pode
  ser re-run em projeto já em andamento.
- Não instale QMD sem confirmar explicitamente o custo (2GB) e a preferência npm/bun.