# ia-framework — Template de desenvolvimento orientado a spec (SDD)

Template **genérico, multi-stack** para desenvolvimento de software com LLMs, baseado no
fluxo SDD Enxuto (Spec-Driven Development). Pensado para uso **100% conversacional** via
orquestrador (opencode ou Claude Code) — o usuário clona, digita `/init` no chat, e a LLM
faz o resto sem ir ao terminal.

## O que vem no template

- **17 agentes de arquitetura/segurança/implementação** especializados por stack
- **8 agentes cross-stack** (context-curator, reviewer, memory-curator, requirements-reader,
  requirements-doctor, sdd-planner, architecture-writer, screens-reader, test-setup, test-author,
  regression-author, contract-checker)
- **22 commands** orquestráveis: `/init`, `/state`, `/req-add`, `/setup-tooling`, SDD (5 fases),
  requirements, testing, architecture, contract-check
- **Skills** com fluxos de 5 fases (Contexto → Spec → Implementação → Review → Report)
- **Scaffold** PowerShell + Bash para migrations versionadas, STATUS.md, INDEX.md
- **8 skills** + 13 templates + 4 JSON schemas

Stacks suportadas (ativo/desativado via manifesto `ia-framework/STACK.md`):

- **Angular 22** (frontend standalone signals, zoneless, `@if/@for/@switch`)
- **Node.js 22+** (backend ESM, Fastify/Express5/NestJS)
- **Java 21+ / Spring Boot 3.5** (virtual threads, records, SecurityFilterChain)
- **Go 1.23+** (context-first, interfaces consumer-side, pgxpool)
- **PostgreSQL 16+** (RLS multi-tenant, particionamento declarativo, JSONB+GIN)

## Início rápido (100% conversacional)

1. **Clone este repositório** como base do seu novo projeto.
2. **Abra no orquestrador** (opencode ou Claude Code).
3. **No chat, rode `/init`** — a LLM fará as perguntas (stacks ativas, QMD opcional, hooks
   pre-commit, `.gitignore`) e configurará tudo via `Bash` sem você ir ao terminal.
4. **Adicione seus requisitos**: `/req-add <caminho-do-arquivo>` (auto-detecta se é
   documento ou tela; copia para `req/` ou `req/screens/`).
5. **Siga um dos 4 caminhos de uso** abaixo.

Se faltar qualquer coisa, a LLM detecta via pre-flight e pergunta se quer rodar o que
falta (`/init`, `/setup-tooling --deps`, `/req-add` etc) — você não precisa memorizar a
ordem exata.

### Alternativa terminal (opcional)

Se preferir ou se o orquestrador não tiver acesso ao filesystem:

```powershell
.\init.ps1          # Windows
./init.sh           # WSL/Linux/macOS
```

Faz o mesmo setup interativo via stdin. **Tip:** `init.ps1`/`init.sh` ficam como
alternativa; o caminho primário para uso 100% conversacional é o command `/init` no
orquestrador.

## 4 caminhos de uso

### A) Documento de requisitos completo (.docx/.pdf/.md)

```
# 1. Copie seu arquivo de fora do projeto
/req-add C:\Users\eu\Downloads\requisito.docx

# 2. Pipeline: extrai + health-check gate + plano
/plan-from-requirements req/requisito.docx
```

Pipeline: extrai texto (`skills/requirements/extract`) → normaliza em
`project_sdd/01-context/requirements.md` → **gate `requirements-doctor`** (score 0-100;
se <50 bloqueia mandatoriamente sem perguntar; se 50+ pergunta continuar/resolver) →
`sdd-planner` abre trilhas `02-specs/NNN-<slug>/spec.md` ordenadas por dependência →
escreve `plan.md`.

Para checar saúde isoladamente (sem gerar plano):
`/requirements-doctor [<file>] [--strict] [--migration] [--no-save]`.

### B) Telas visuais (.png/.fig/.xd) + documento

```
/req-add C:\Users\eu\Downloads\orders-list.png          # detecta extensão, vai para req/screens/
/load-screens req/screens/                              # anexe a imagem ao prompt; LLM vision descreve
/plan-from-requirements req/requisito.docx              # gate doctor; trilhas Angular referenciam IDs de tela
```

### C) Prompt curto sem documento

```
/plan-from-prompt "marketplace de produtos com checkout Pix e cartão"
```

Protocolo de **aprovação em 4 fases**: Perguntas → Critérios de aceite → Plano → Execução.
Nada é implementado antes da sua aprovação explícita da Fase C.

### D) Bug pontual

```
/sdd-bug-fix fix-checkout-vazio
```

Pipeline: `/tests-regression` reproduz (red, `red_confirmed: true`) → implementador corrige
causa-raiz → `/tests-run --level=regression` confirma green.

## Após gerar plano: execute trilha a trilha

```
/sdd --stack=<id> <tipo> <slug>     # fluxo completo de 5 fases
     # fase 3: implementador escreve código + unit puro
     # fase 4: reviewer confere bullets com arquivo:linha
     # fase 5: prompt sugere /tests-release
```

Ao final de um eixo de desenvolvimento:

```
/tests-release --stack=all           # gera plano de testes em docs/testing/
/generate-architecture --stack=all   # snapshot em docs/architecture/
/contract-check                      # confere contrato backend ↔ frontend
```

## Estado e diagnóstico

A qualquer momento, pergunte "como está o setup?" e a LLM pode rodar:

```
/state
```

Mostra uma tabela `✓ / ✗ / ⚠` com tudo o que está configurado e o que falta, além de
próximo passo sugerido.

## Comandos de setup (instalação conversacional)

| Command | O que faz |
|---|---|
| `/init` | Wizard de bootstrap (stacks + QMD + hooks + .gitignore) |
| `/state` | Diagnóstico read-only do estado do projeto |
| `/req-add <path>` | Copia arquivo externo para `req/` ou `req/screens/` |
| `/setup-tooling --apps` | Cria o skeleton dos apps por stack ativa (`ng new`, `npm init`, `go mod init`, Spring Initializr) |
| `/setup-tooling --deps` | `npm install`/`mvn install`/`go mod tidy` por stack ativa |
| `/setup-tooling --qmd` | Instala QMD + qmd init + collections + qmd embed (~2GB) |
| `/setup-tooling --pdftotext` | Instala poppler via package manager do SO |
| `/setup-tooling --hooks` | `pre-commit install` + descomenta stacks no `.pre-commit-config.yaml` |
| `/setup-tooling --all` | Todas as anteriores (cada com confirmação) |

Cada sub-operação pede confirmação antes de modificar o sistema (lockfiles, package
manager global, binary global).

## Onde está cada coisa

- `ia-framework/STACK.md` — manifesto de stacks ativas (editado pelo `/init`)
- `ia-framework/agents/` — 25 agentes especializados + cross-stack
- `ia-framework/commands/` — 22 commands orquestráveis
- `ia-framework/skills/` — skills de fluxo (SDD, requirements, architecture, testing,
  memory, protocol, screens, shared) + stack-specific (angular/nodejs/spring/go/postgres)
- `ia-framework/skills/scaffold.{ps1,sh}` — bootstrap de árvore SDD
- `ia-framework/skills/shared/preflight.md` — invariáveis mínimas para todo command
- `project_sdd/` — criado pelo `/init` (não commit code aqui; só docs SDD)
- `docs/architecture/` — snapshot arquitetura per-release (via `/generate-architecture`)
- `docs/testing/` — planos de teste finais (via `/tests-release`)
- `req/` — coloque seus requisitos (.docx/.pdf/.md) e telas (.png) (via `/req-add`)
- `examples/petshop/` — exemplo minimal resolvido (consulte para entender o "modo certo")
- `AGENTS.md` — índice para LLMs (lido automaticamente por opencode)
- `docs/USAGE.md` — fluxo estendido com diagrama de lifecycle de trilha

## Princípios (anti-alucinação)

1. **Spec antes do código.** Toda tarefa tem bullet de comportamento alvo e `reviewer`
   confere com `arquivo:linha`.
2. **Stack-aware.** Implementadores carregam `references/arquitetura.md` da stack antes de
   codar; padrões explícitos, não implícitos.
3. **Segurança de primeira classe.** 5 agentes de segurança + command, mapeando OWASP.
4. **Testes integrados às 5 fases.** Implementador escreve unit puro; bug-fix exige
   regressão `red_confirmed: true`; release sugere system/acceptance/E2E.
5. **Memória token-efficient.** `project_sdd/INDEX.md` (~500 tokens) consultado antes de
   mergulhar em `01-context/`. Atualizado automaticamente na fase 5 do SDD.
6. **Aprovação em prompt.** `/plan-from-prompt` não executa antes da sua aprovação das
   fases A→C — idêntico a code review mas para plano.
7. **Gate pré-planejamento.** `requirements-doctor` valida qualidade do documento de
   requisitos; score <50 bloqueia mandatoriamente; 50+ pergunta continuar/resolver.
8. **Conversacional end-to-end.** Setup, adição de requisitos, diagnóstico de estado,
   instalação de deps — tudo via comandos. O terminal é fallback, não primário.

## Documentação

- `docs/USAGE.md` — fluxo detalhado com diagrama de lifecycle
- `docs/UPDATING.md` — como receber atualizações deste template via git subtree
- `examples/README.md` — como navegar pelo exemplo petshop

## Versionamento

- `ia-framework/VERSION` — semver do template (atual `1.2.0`)
- `ia-framework/CHANGELOG.md` — histórico de mudanças

## Licença

(sua licença — preencha)
