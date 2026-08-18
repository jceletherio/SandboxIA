# AGENTS.md — Índice para LLMs

Este arquivo é lido automaticamente por ferramentas como **opencode** para indexar
agentes, commands e skills do projeto. Edite conforme o seu projeto evolui.

## Fluxo recomendado (em ordem)

1. **Setup inicial** (uma vez): no chat, rode `/init` — wizard conversacional (stacks,
   QMD, hooks, .gitignore). Alternativa terminal: `./init.ps1` (ou `./init.sh`).
2. **Carregar requisitos**: `/req-add <caminho-do-arquivo>` (auto-detecta extensão) ou
   `/load-requirements <file>` para já disparar o doctor gate.
   - Atalho para prompt curto: `/plan-from-prompt "<descrição>"`.
3. **Preparar testes** (uma vez): `/setup-tooling --deps` ou `/tests-setup --stack=all`.
4. **Executar trilha SDD**: `/sdd --stack=<id> <tipo> <slug>`.
5. **Finalizar release**: `/tests-release --stack=all` + `/generate-architecture
   --stack=all`.

A qualquer momento: `/state` para diagnóstico read-only do setup.

## Agents ativos

### Cross-stack (genéricos)
- `agents/context-curator.md` — bootstrap/update do `01-context/`
- `agents/reviewer.md` — review cross-stack (fase 4 SDD)
- `agents/memory-curator.md` — mantém `project_sdd/INDEX.md` atualizado
- `agents/requirements-reader.md` — extrai/normaliza documentos externos
- `agents/requirements-doctor.md` — verifica a saúde do documento de requisitos (gate pré-planejamento)
- `agents/requirements-doctor.md` — verifica a saúde do documento de requisitos (gate pré-planejamento)
- `agents/sdd-planner.md` — gera trilhas SDD a partir de requisitos
- `agents/prototype-planner.md` — divide requisitos em partes P-NNN do protótipo de telas
- `agents/prototype-designer.md` — desenha telas com Material Design 3 + contrato de mock
- `agents/prototype-builder.md` — implementa partes do protótipo com mock estruturado p/ backend
- `agents/prototype-reviewer.md` — revisa completude RF/US + conformidade M3 do protótipo
- `agents/architecture-writer.md` — persiste decisões em `docs/architecture/`
- `agents/screens-reader.md` — descreve telas visuais via LLM vision
- `agents/test-setup.md` — prepara tooling de testes por stack
- `agents/test-author.md` — escreve testes num nível dado
- `agents/regression-author.md` — escreve teste de regressão em bug-fix
- `agents/contract-checker.md` — confere contrato backend ↔ frontend

### Angular 22
- `agents/angular-arquiteto.md` — decisões de arquitetura Angular
- `agents/angular-seguranca.md` — revisão de segurança Angular
- `agents/angular-implementador.md` — implementa UMA tarefa da spec

### React 19+
- `agents/react-arquiteto.md` — decisões de arquitetura React (Query, Zustand, rotas)
- `agents/react-seguranca.md` — revisão de segurança React (XSS, CSP, tokens)
- `agents/react-implementador.md` — implementa UMA tarefa da spec

### Node.js 22+
- `agents/nodejs-arquiteto.md`, `agents/nodejs-seguranca.md`, `agents/nodejs-implementador.md`

### Java 21+ / Spring Boot 3.5
- `agents/spring-arquiteto.md`, `agents/spring-seguranca.md`, `agents/spring-implementador.md`

### Go 1.23+
- `agents/go-arquiteto.md`, `agents/go-seguranca.md`, `agents/go-implementador.md`

### PostgreSQL 16+
- `agents/postgres-arquiteto.md`, `agents/postgres-seguranca.md`, `agents/postgres-implementador.md`

## Skills (fluxos)

- `skills/shared/flow.md` — 5 fases do SDD Enxuto
- `skills/stacks/<stack>/SKILL.md` — fluxo específico por stack (6 stacks)
- `skills/requirements/SKILL.md` — ingestão de requisitos
- `skills/architecture/SKILL.md` — geração de `docs/architecture/`
- `skills/testing/SKILL.md` — camada de testes integrada às 5 fases
- `skills/memory/SKILL.md` — índice token-efficient + QMD opcional
- `skills/protocol/SKILL.md` — protocolo de aprovação 4 fases (`/plan-from-prompt`)
- `skills/screens/SKILL.md` — ingestão de telas via vision
- `skills/prototyping/SKILL.md` — protótipo de telas (M3 + mock estruturado p/ backend)

## Commands

### Setup conversacional (use no chat do orquestrador)

| Command | Descrição |
|---|---|
| `/init` | Wizard de bootstrap (stacks, QMD, hooks, .gitignore). Caminho primário. |
| `/state` | Diagnóstico read-only do estado do projeto. |
| `/req-add <source-path>` | Copia arquivo externo para `req/` (docs) ou `req/screens/` (telas). |
| `/setup-tooling [--apps\|--deps\|--qmd\|--pdftotext\|--hooks\|--all]` | Scaffold de apps + instala ferramental por sub-operação; cada uma pede confirmação. `--apps` cria o skeleton dos apps (ng new/npm init/go mod init/Spring). |

### SDD — fluxo de 5 fases

| Command | Descrição |
|---|---|
| `/sdd` | Fluxo SDD completo (5 fases) |
| `/sdd-feature` | Feature escopo claro (sem spec separada) |
| `/sdd-bug-fix` | Bug pontual + regressão obrigatória |
| `/sdd-context` | Bootstrap ou refresh do `01-context/` |
| `/sdd-review` | só fase 4 (review + testes) |
| `/sdd-arquitetura` | decisão arquitetural de uma stack |
| `/sdd-seguranca` | análise de segurança de uma stack |

### Requisitos e plano

| Command | Descrição |
|---|---|
| `/load-requirements <file>` | Carrega `.docx/.pdf/.md` em `01-context/requirements.md`; health-check embutido |
| `/plan-from-requirements <file>` | Pipeline: carrega + gate doctor + gera trilhas SDD + plano. Se existir protótipo (`01-context/prototype/`), reusa partes P-NNN nas trilhas frontend e DTOs do mock como contrato backend. |
| `/requirements-doctor [<file>] [--strict] [--migration] [--no-save]` | Verifica saúde do documento de requisitos; gate pré-planejamento |
| `/load-screens <dir>` | Descreve telas `.png/.fig/.xd` via LLM vision |
| `/plan-from-prompt "<desc>"` | Plano via prompt com aprovação em 4 fases |
| `/prototype-screens [<escopo>\|--part=P-NNN]` | Protótipo de telas a partir de requisitos (M3 + mock estruturado p/ backend) |

### Testes

| Command | Descrição |
|---|---|
| `/tests-setup` | prepara tooling de testes |
| `/test-add <level>` | escreve um teste novo |
| `/tests-run` | roda as suítes existentes |
| `/tests-regression` | escreve teste de regressão (red) em bug-fix |
| `/tests-release` | gera testes de final (system/acceptance/E2E) |

### Release

| Command | Descrição |
|---|---|
| `/contract-check` | confere contrato backend ↔ frontend |
| `/generate-architecture` | gera/atualiza `docs/architecture/` |

Todos os commands seguem o pre-flight `skills/shared/preflight.md`: verificam `STACK.md`
configurado e `project_sdd/01-context/` existente. Se faltar, perguntam ao usuário se
quer rodar `/init` chained.

## Scaffold (CLI)

```
pwsh ia-framework/skills/scaffold.ps1 init <root>      # cria arvore SDD
pwsh ia-framework/skills/scaffold.ps1 new <tipo> [NNN] <slug>
pwsh ia-framework/skills/scaffold.ps1 harvest <raiz>
pwsh ia-framework/skills/scaffold.ps1 index --write
# ou em WSL/Linux/macOS: bash ia-framework/skills/scaffold.sh <cmd> ...
```

## Manifesto de stacks

Edite `ia-framework/STACK.md` para ativar/desativar stacks. Agents recusam tarefa em stack
inativa.

## Memória token-efficient

Antes de mergulhar em `01-context/`, leia `project_sdd/INDEX.md` (~500 tokens). Ele é
atualizado em cada fase 5 do SDD automaticamente pelo `memory-curator`.

## Limitação

Sem browser/cluster/Docker dentro de uma sessão SDD. Testcontainers/Playwright pedem
confirmação. `pdftotext` (poppler) é dependência externa para PDF; `.docx` extrai via
OpenXML puro (sem Office/COM).