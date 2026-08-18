---
name: architecture
description: Gera e mantém documentação de arquitetura do projeto em `docs/architecture/` — overview cross-stack + um doc por stack ativa, em Markdown + Mermaid. Delega decisões aos 6 agentes `<stack>-arquiteto` existentes e persiste as saídas em templates de longa vida. Reutilizado por `/generate-architecture`. Gatilhos: "gerar arquitetura", "documentar arquitetura", "/generate-architecture", "escrever ADR", "diagrama Mermaid".
---

# Arquitetura — Persistindo Decisões em `docs/architecture/`

Conduz a **persistência** de decisões arquiteturais em `docs/architecture/`. Não decide
arquitetura — isso é com os 6 agentes `<stack>-arquiteto` existentes em `agents/`. Aqui,
compilamos suas saídas em templates de longa vida.

## Pipeline

```
/generate-architecture --stack=<id|all>
  │
  ├─ architecture-writer
  │    ├─ lê ia-framework/STACK.md
  │    ├─ carrega skills/stacks/<stack>/references/arquitetura.md (regras da stack)
  │    ├─ delega a <stack>-arquiteto (já existente) por stack ativa
  │    ├─ compila saída JSON em templates/architecture/<stack>.md
  │    └─ escreve em docs/architecture/<stack>.md
  │
  └─ atualiza docs/architecture/overview.md (cross-stack)
```

## Princípios

1. **Não decide arquitetura.** Delega. Sem decisão nova aqui — só persistência de output
   dos arquitetos. Fonte de verdade permanece os agents.
2. **Markdown + Mermaid.** Diagramas em **Mermaid** (GitHub/VSCode native rendering) —
   nada de ASCII art. Diagrama editável survive diff revisions. Convenções em
   `references/diagrams.md`.
3. **Doc de longa vida.** O documento vale entre releases. Atualizar é operação
   deliberada (re-rode `/generate-architecture --stack=<id>`). Sem rewrite automático em
   cada commit.
4. **Stack-aware.** Doc por stack isolado (frontend-angular.md, backend-spring.md, ...).
   Overview separado para caminhos cross-stack (request→response, autenticação, fluxo
   crítico).
5. **Sem narrativa de processo.** Decisão + razão + alternativas descartadas. Sem log de
   "eu decidi X porque Y em data Z".

## Saídas esperadas em `docs/architecture/`

| Doc | Quando |
| --- | ----- |
| `overview.md` | Sempre — cross-stack, diagrama, fluxo crítico, ADRs relevantes |
| `frontend-angular.md` | Stack `angular` ativa em STACK.md |
| `frontend-react.md` | Stack `react` ativa em STACK.md |
| `backend-nodejs.md` | Stack `nodejs` ativa |
| `backend-spring.md` | Stack `spring` ativa |
| `backend-go.md` | Stack `go` ativa |
| `database-postgres.md` | Stack `postgres` ativa |

Cada doc segue seu template em `templates/architecture/`. Estrutura obrigatória em
`references/structure.md`.

## Quando atualizar

- Depois de uma ADR aceita em `03-decisions/` que afeta a stack.
- Depois de mudança de versão major de framework (Angular 22 → 23, Spring Boot 3.5 → 4).
- Antes de release — checklist de divulgação técnica.
- Quando `STACK.md` muda (mesma framework removida ou adicionada).

## Quando NÃO usar

- Mudança reversível no código — fica na spec do `/sdd` normal.
- Documentação interna de equipe (runbooks, onboarding) — outro lugar.
- RFC de nova stack — virar ADR primeiro; persiste quando aceita.