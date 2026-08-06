# Changelog — ia-framework

Formato [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versionamento
[SemVer](https://semver.org/).

Cada release deste template é tagada. Projetos downstream queiram consultar `docs/UPDATING.md`
para instrução de git subtree pull.

## [1.2.0] — 2026-08-05

### Added
- **Modo conversacional end-to-end.** Clone + digite `/init` no orquestrador (opencode/Claude
  Code) e a LLM faz o resto sem ir ao terminal.
- **`/init`** command — wizard conversacional que pergunta stacks ativas, QMD, pre-commit
  hooks e `.gitignore` via `AskUserQuestion`; executa via `Bash` (mkdir, scaffold, npm,
  `qmd init`, etc). Caminho primário para setup. Substitui `init.ps1`/`init.sh` como UX
  padrão (estes ficam como alternativa terminal).
- **`/state`** command — diagnóstico read-only do estado (template version, STACK.md
  configurado, project_sdd, INDEX.md, req/, telas, qmd, pdftotext, pre-commit, deps por
  stack) com tabela `✓ / ✗ / ⚠` e próximo passo sugerido. Útil em "como está o setup?".
- **`/req-add <source-path>`** command — copia arquivo externo (`.docx/.pdf/.md/.txt` →
  `req/`; `.png/.jpg/.fig/.xd/.sketch` → `req/screens/`). Detecta extensão
  automaticamente; cria pasta se faltar.
- **`/setup-tooling [--deps] [--qmd] [--pdftotext] [--hooks] [--all]`** command unificado
  para instalação de ferramental. Cada sub-operação pede confirmação explícita antes de
  modificar sistema (lockfile, package manager global, binary global). Modular — usuário
  pode rodar `--deps` isolado ou `--all` numa tacada.
- **`skills/shared/preflight.md`** — invariáveis mínimas compartilhadas por todos os
  commands. Detecta estado faltante; em vez de falhar silenciosamente (alucinação),
  pergunta ao usuário se quer rodar `/init` chained. Reforço o protocolo
  "100% conversacional": nenhum command SDD prossiga sem pré-voo OK.

### Changed
- **18 commands SDD existentes** ganharam bloco `## Pré-voo` no início da `## Condução`
  (ou primeira seção de execução para os 5 que não têm `## Condução`):
  `sdd`, `sdd-feature`, `sdd-bug-fix`, `sdd-context`, `sdd-review`, `sdd-arquitetura`,
  `sdd-seguranca`, `load-requirements`, `plan-from-requirements`, `requirements-doctor`,
  `load-screens`, `plan-from-prompt`, `tests-setup`, `test-add`, `tests-run`,
  `tests-regression`, `tests-release`, `contract-check`, `generate-architecture`.
  Cada pre-flight: verifica `STACK.md` configurado + `project_sdd/01-context/` existe;
  se faltar, pergunta "rodar `/init`?"; chained se sim, abort se não.
- `README.md` reescrito: fluxo primário é `/init` no chat; `init.ps1` virou "alternativa
  terminal" com banner.
- `AGENTS.md` adiciona 4 commands à tabela (`/init`, `/state`, `/req-add`, `/setup-tooling`).
- `init.ps1`/`init.sh`: banner no topo do output apontando `/init` no orquestrador como
  caminho primário; script vira fallback explícito.

### Migration notes (de 1.1.0 → 1.2.0)
- **Sem breaking change em commands SDD.** A única mudança visível é o bloco `## Pré-voo`
  adicionado a 18 commands — comportamento idêntico, apenas agora detectam estado faltante
  e perguntam ao usuário antes de seguir.
- Quem estava usando `init.ps1`/`init.sh` direto: scripts continuam funcionando; banner
  agora aponta para `/init` como primário.
- Comportamento de orquestrador: ao receber um command SDD com estado faltante, a LLM
  perguntará via `AskUserQuestion` antes de proseguir; se chained, `/init` é invocado
  primeiro e o command original retoma automaticamente.

## [1.1.0] — 2026-08-05

### Added
- **`requirements-doctor`** agente + command + skill `health-check.md`: gate pré-
  planejamento que avalia 8 dimensões do documento de requisitos (parseability/front-
  matter, visão, epics, US, RF, RNF, lacunas etiquetadas, coerência estrutural) e atribui
  score 0-100.
- **Sempre apresenta** relatório completo ao usuário; **sempre pergunta** "Continuar |
  Resolver pendências" quando score ≥50; **bloqueia mandatoriamente sem perguntar** quando
  score <50 (default) ou <80 (com `--strict`).
- **Persistência versionada**: cada execução grava
  `project_sdd/01-context/requirements-health/vNNN-<timestamp>.md` (nunca overwrite;
  numeração incremental `v001`, `v002`, ...) + atualiza `requirements-health/INDEX.md`
  (cache de auditoria 1 linha/exec) + atualiza `kpis.health`/`kpis.last_check`/
  `kpis.last_score` no front-matter do `requirements.md`.
- **Flags**: `--strict` (threshold <80 ao invés de <50), `--migration` (zero US/RF não
  bloqueia; `context: migration`), `--no-save` (modo diagnóstico sem persistir).

### Changed
- `/plan-from-requirements` agora inclui gate `requirements-doctor` antes do `sdd-planner`;
  aborta se `blocked` ou se usuário escolher "Resolver pendências".
- `/load-requirements` dispara `requirements-doctor` após persistir `requirements.md`;
  aplica regra de pergunta/bloqueio antes de finalizar.
- `requirements-reader` não computa score — apenas etiqueta lacunas; `kpis.health`
  inicial do front-matter é heurística e será sobrescrita pelo doctor.

### Migration notes (de 1.0.0 → 1.1.0)
- Sem breaking change. Projetos downstream que invocam `/load-requirements` ou
  `/plan-from-requirements` ganham gate automaticamente — flow fica mais rigoroso.
- Para evitar gate em um call pontual, use `/requirements-doctor <file> --no-save` como
  diagnosticador isolado.

## [1.0.0] — 2026-08-05

### Added
- **15 agentes de arquitetura/segurança/implementação** por stack (Angular 22, Node.js 22+,
  Spring Boot 3.5, Go 1.23+, PostgreSQL 16+)
- **2 agentes genéricos** (context-curator, reviewer)
- **6 agentes complementares** (requirements-reader, sdd-planner, architecture-writer,
  test-setup, test-author, regression-author, memory-curator, screens-reader,
  contract-checker)
- **18 commands** SDD (`/sdd`, `/sdd-feature`, `/sdd-bug-fix`, `/sdd-context`, `/sdd-review`,
  `/sdd-arquitetura`, `/sdd-seguranca`, `/load-requirements`, `/plan-from-requirements`,
  `/generate-architecture`, `/tests-setup`, `/test-add`, `/tests-run`, `/tests-regression`,
  `/tests-release`, `/contract-check`, `/load-screens`, `/plan-from-prompt`)
- **8 skills** (shared, stacks/<5>, requirements, architecture, testing, memory,
  protocol, screens) com 4 JSON schemas, 8 templates de contexto/spec/ADR/protocol/screen
- **Scaffold** PowerShell + Bash (init, new, harvest, context, index, migrate)
- **Scripts** `extract.ps1`/`.sh` para .docx (OpenXML puro) e .pdf (pdftotext detectado)
- **Validation gates** por stack (`skills/shared/validation-gates.md`)
- **.pre-commit-config.template.yaml** template com gitleaks + hooks por stack comentados
- **Memória token-efficient** (`extract-index.{ps1,sh}`) + QMD optional para semantic search
- **Protocolo de aprovação 4 fases** para `/plan-from-prompt` (perguntas → CAs → plano →
  execução) com log de auditoria em `protocol.md`
- **Ingestão de telas** via LLM vision anexada ao prompt (`screens-reader`)
- **Contract-checker** que confere `api-context.md` ↔ tipos/handlers no código
- **examples/petshop/** com requisito.md, requirements.md, screens/S-001, plan.md, 3 specs
  resolvidas, overview de arquitetura, test-plan frontend
- **init.ps1** + **init.sh** wizard de bootstrap pós-clone
- **README.md** raiz com 4 caminhos de uso; **AGENTS.md** índice para LLMs; **docs/USAGE.md**
  fluxo estendido; **docs/UPDATING.md** estratégia git subtree
- **KPIs no topo do STATUS.md** (X abertas | Y bloqueadas | Z prontas)
- **INDEX.md** atualizado automaticamente por `memory-curator` em cada fase 5

### Documentação
- Consulte `docs/USAGE.md` para o lifecycle de uma trilha SDD.
- Consulte `examples/README.md` para navegar pelo exemplo petshop.