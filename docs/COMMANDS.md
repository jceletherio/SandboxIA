# Guia de Comandos e Uso do Projeto

> Manual prático dos **slash commands** e da estrutura do projeto (template `ia-framework`,
> fluxo SDD Enxuto). Para o fluxo estendido, veja `docs/USAGE.md`; para o índice técnico
> de agentes/skills, `AGENTS.md`.

---

## 1. Visão geral

Este projeto é um **framework de desenvolvimento orientado a spec (SDD)** para ser usado
**100% conversacional** via orquestrador (opencode / Claude Code). Você conversa com a LLM
e ela faz o setup, lê requisitos, planeja, implementa, testa e gera documentação — você
aprova nos momentos-chave.

Estrutura:

```
ia-framework/            # "cérebro": agentes, commands, skills, scaffold (não editar sem motivo)
  agents/                # LLM agents especializados (implementadores, arquitetos, revisores...)
  commands/              # definições dos slash commands
  skills/                # fluxos (SDD, requirements, prototyping, testing...) + referências
  STACK.md               # manifesto de stacks ativas (angular/nodejs/spring/go/postgres)
project_sdd/             # memória SDD (CRIADO pelo /init — não commit código aqui)
  01-context/            # requirements.md, plan.md, screens/, prototype/, api-context.md
  02-specs/              # trilhas SDD (NNN-<slug>/spec.md)
  03-decisions/          # ADRs
  INDEX.md               # índice token-efficient (~500 tokens) — consulte antes de mergulhar
src/                      # código de aplicação (criado por /setup-tooling --apps)
  frontend/               # app Angular
  backend/<stack>/        # apps backend por stack ativa
  BD/                     # migrations/RLS PostgreSQL
docs/                    # USAGE, UPDATING, architecture/, testing/ (snapshots por release)
req/                     # requisitos (.docx/.pdf/.md) e telas (.png) — entrada
examples/petshop/        # exemplo resolvido de ponta a ponta
```

---

## 2. Como começar (fluxo de inicialização)

Ordem recomendada no chat:

| Passo | Command | O que faz |
|---|---|---|
| 1 | `/init` | Wizard: ativa stacks (Angular, Node, Postgres...), QMD opcional, hooks, `.gitignore`; cria a árvore SDD |
| 2 | `/setup-tooling --apps` | Cria o skeleton dos apps (`ng new`, `npm init`, `go mod init`, Spring Initializr) por stack ativa |
| 3 | `/setup-tooling --deps` | Instala dependências de runtime (`npm install` etc.) |
| 4 | `/req-add <arquivo>` | Copia seu documento de requisitos para `req/` (ou telas para `req/screens/`) |
| 5 | `/load-requirements <file>` | Extrai para `01-context/requirements.md` + health-check |
| 6 | `/plan-from-requirements <file>` | Gate + gera trilhas SDD (`02-specs/`) + plano |
| 7 | `/sdd --stack=<id> <tipo> <slug>` | Executa cada trilha (5 fases) |
| 8 | `/tests-release --stack=all` + `/generate-architecture --stack=all` | Planos de teste final + snapshot de arquitetura |

> Dica: a qualquer momento rode `/state` para diagnóstico read-only do setup.

---

## 3. Slash commands por categoria

### 3.1 Setup

| Command | Descrição |
|---|---|
| `/init` | Wizard de bootstrap (stacks, QMD, hooks, `.gitignore`). Caminho primário. |
| `/state` | Diagnóstico read-only do estado do projeto (tabela ✓/✗/⚠). |
| `/req-add <path>` | Copia arquivo externo para `req/` (docs) ou `req/screens/` (imagens). Detecta extensão. |
| `/setup-tooling [--apps\|--deps\|--qmd\|--pdftotext\|--hooks\|--all]` | Cria apps e instala ferramental; cada sub-operação pede confirmação. |

### 3.2 SDD (fluxo de 5 fases)

| Command | Descrição |
|---|---|
| `/sdd --stack=<id> <tipo> <slug>` | Fluxo completo: Contexto → Spec+Tarefas → Implementação → Review+Testes → Report |
| `/sdd-feature --stack=<id> <slug>` | Feature de escopo claro (sem spec separada) |
| `/sdd-bug-fix <slug>` | Bug pontual + regressão obrigatória (red → fix → green) |
| `/sdd-context` | Bootstrap ou refresh do `01-context/` |
| `/sdd-review --stack=<id> <NNN>` | Só a fase 4 (review + testes) |
| `/sdd-arquitetura --stack=<id> [tópico]` | Decisão arquitetural de uma stack |
| `/sdd-seguranca --stack=<id>` | Análise de segurança de uma stack (OWASP) |

**As 5 fases do `/sdd`:**

1. **Contexto** — mapa de arquivos/regiões + perguntas em bloco.
2. **Spec + Tarefas** — `02-specs/NNN-<slug>/spec.md` (comportamento alvo, contratos, tarefas).
3. **Implementação** — agente `<stack>-implementador`; um commit por tarefa.
4. **Review + Testes** — agente `reviewer`: confere cada bullet contra o código com
   `arquivo:linha` e roda a suíte. `verdict: ready | blocked`.
5. **Report** — decisões não óbvias + achados; atualiza memória.

### 3.3 Requisitos e plano

| Command | Descrição |
|---|---|
| `/load-requirements <file>` | Extrai `.docx/.pdf/.md` para `01-context/requirements.md`; health-check embutido. |
| `/requirements-doctor [<file>] [--strict] [--migration] [--no-save]` | Verifica a saúde do documento (score 0-100); gate pré-planejamento. |
| `/plan-from-requirements <file>` | Pipeline completo: carrega + gate doctor + gera trilhas + plano. **Se houver protótipo**, reusa partes `P-NNN` no frontend e DTOs do mock como contrato backend. |
| `/load-screens <dir>` | Descreve telas `.png/.fig/.xd` via LLM vision (anexe as imagens no prompt). |
| `/plan-from-prompt "<desc>"` | Plano via prompt curto, com aprovação em 4 fases (Perguntas → CAs → Plano → Execução). |

### 3.4 Protótipo de telas

| Command | Descrição |
|---|---|
| `/prototype-screens [<escopo>\|--part=P-NNN]` | Cria protótipo navegável (Angular + Material Design 3) a partir dos requisitos: divisão em partes (P-NNN), design M3, **dados mockados porém estruturados em interface/gateway** prontos para o backend definitivo, e revisão de completude contra os RF/US. |

Depois, `/plan-from-requirements` detecta o protótipo e pergunta se quer **reusar** as
partes nas trilhas de produção (frontend referencia `P-NNN`; backend herda os DTOs do mock).

### 3.5 Testes

| Command | Descrição |
|---|---|
| `/tests-setup` | Prepara tooling de testes (vitest, playwright, pgTAP...). |
| `/test-add <level>` | Escreve um teste novo (`unit`/`functional`/`integration`/`regression`). |
| `/tests-run [--level=...] [--stack=<id>]` | Roda as suítes existentes. |
| `/tests-regression` | Escreve teste de regressão (red) em bug-fix. |
| `/tests-release --stack=<id\|all>` | Gera testes finais (system/acceptance/E2E) + plano em `docs/testing/`. |

### 3.6 Release

| Command | Descrição |
|---|---|
| `/contract-check` | Confere o contrato backend ↔ frontend (usa os DTOs do mock como fonte quando `api-context.md` vazio). |
| `/generate-architecture --stack=<id\|all>` | Gera/atualiza snapshots em `docs/architecture/`. |

> Todos os commands rodam um **pre-flight** (`skills/shared/preflight.md`): se
> `STACK.md` não estiver configurado ou `project_sdd/01-context/` não existir, eles
> perguntam se você quer rodar `/init` antes.

---

## 4. Caminhos de uso (como entrar)

| Situação | Caminho |
|---|---|
| **A. Requisitos completos** (`.docx/.pdf/.md`) | `/req-add` → `/plan-from-requirements` → `/sdd` por trilha |
| **A2. Protótipo antes do plano** | `/prototype-screens "fluxo X"` → `/plan-from-requirements` (reusa P-NNN) → `/sdd` |
| **B. Telas visuais** (`.png`) | `/req-add` → `/load-screens` (anexe a imagem) → `/plan-from-requirements` → `/sdd` |
| **C. Prompt curto** | `/plan-from-prompt "<desc>"` → aprovação em 4 fases → `/sdd` |
| **D. Bug pontual** | `/sdd-bug-fix <slug>` (regressão red → fix → green) |

---

## 5. Detalhes importantes

### Manifesto de stacks (`ia-framework/STACK.md`)

Define quais stacks estão ativas. Agentes **recusam** tarefa em stack inativa. Use
`--stack=<id>` quando o comando precisa de uma stack (`angular`, `nodejs`, `spring`, `go`,
`postgres`); sem isso, a stack é inferida da raiz do código tocado.

### Memória token-efficient

`project_sdd/INDEX.md` (~500 tokens) resume o estado do projeto. Leia-o **antes** de
mergulhar em `01-context/`. É atualizado automaticamente na fase 5 de cada trilha SDD.

### Convenções de commit

Commits convencionais, um por tarefa (ex.: `feat(orders): lista com filtros`,
`fix(auth): refresh token expirado`). Detalhes em `ia-framework/skills/shared/git-conventions.md`.

### Limitações de sessão

- Sem browser/cluster/Docker dentro de uma sessão SDD — Testcontainers/Playwright pedem
  confirmação.
- `pdftotext` (poppler) é dependência externa para `.pdf`; `.docx` extrai via OpenXML puro.
- Validação visual (UX/estados) é feita pelo humano: o `reviewer` marca esses itens como
  `requires_human_validation`.

### Scaffold (CLI, alternativa ao orquestrador)

```
pwsh ia-framework/skills/scaffold.ps1 init <root>      # cria a árvore SDD
pwsh ia-framework/skills/scaffold.ps1 new <tipo> [NNN] <slug>
pwsh ia-framework/skills/scaffold.ps1 harvest <raiz>
pwsh ia-framework/skills/scaffold.ps1 index --write
# ou em WSL/Linux/macOS: bash ia-framework/skills/scaffold.sh <cmd> ...
```
