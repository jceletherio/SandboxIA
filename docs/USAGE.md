# USAGE — Fluxo estendido do template ia-framework

> Diagrama de lifecycle de trilha + navegação pelos 4 caminhos de uso. Para referência
> rápida, veja `README.md`. Para índice de agentes/skills, `AGENTS.md`.

## Lifecycle de uma trilha SDD

```
┌──────────────────┐
│ req/             │  documento .docx/.pdf/.md + telas .png
│ req/screens/     │
└────────┬─────────┘
         │ /plan-from-requirements  ou  /plan-from-prompt
         │ (+ protótipo 01-context/prototype/ via /prototype-screens)
         ▼
┌──────────────────┐
│ 01-context/      │  requirements.md  +  screens/<id>.md  +  plan.md
│ 02-specs/        │  NN-<slug>/spec.md  (1 por feature coesa)
└────────┬─────────┘
         │ /sdd --stack=<id> <tipo> <slug>
         ▼
┌──────────────────┐
│ Fase 1: Contexto │  mapa de arquivos/regiões + ambiguidades em bloco
├──────────────────┤
│ Fase 2: Spec     │  spec.md: comportamento alvo + contratos + tarefas
├──────────────────┤
│ Fase 3: Impl.     │  implementador + unit puro; sugere /test-add
├──────────────────┤
│ Fase 4: Review    │  reviewer + suíte existente + bug-fix → regression
├──────────────────┤
│ Fase 5: Report    │  decisões + achados; atualiza 01-context/ + INDEX.md
└────────┬─────────┘
         │ (repete por trilha)
         ▼
┌──────────────────┐
│ /tests-release   │  docs/testing/test-plan-<stack>.md
│ /generate-       │  docs/architecture/<stack>.md + overview.md
│   architecture   │
└──────────────────┘
```

## 4 caminhos de entrada

### A) Requisitos completos (default)
1. Coloque `requisito.docx` (ou `.pdf`/`.md`) em `req/`.
2. `/plan-from-requirements req/requisito.docx`
   - `requirements-reader` gera `project_sdd/01-context/requirements.md`
   - `sdd-planner` abre trilhas `02-specs/NNN-<slug>/spec.md` + `plan.md`
   - Se houver protótipo (`01-context/prototype/`), o fluxo pergunta se reusa as partes
     `P-NNN` nas trilhas frontend e os DTOs do mock como contrato backend (drift vira
     lacuna, não bloqueia).
3. Para cada trilha: `/sdd --stack=<id> feature <slug>`.
4. Ao final: `/tests-release --stack=all` + `/generate-architecture --stack=all`.

### A2) Protótipo antes do plano (UX validada primeiro)
1. Requisitos em `req/` → `/plan-from-requirements` (opcional, para `requirements.md`).
2. `/prototype-screens "fluxo X"` — divisão em partes `P-NNN`, design M3, dados mockados
   em interface/gateway; persiste em `01-context/prototype/` + `frontend/src/app/prototype/`.
3. `/plan-from-requirements req/requisito.docx` — o `sdd-planner` reusa as partes `P-NNN`
   nas trilhas frontend e os DTOs do mock como contrato obrigatório das trilhas backend
   (ver `ia-framework/skills/prototyping/references/feeding-sdd.md`).
4. Mesmo fluxo de A) a partir do passo 3.

### B) Telas + requisitos
1. Coloque `.png`/`.fig`/`.xd` em `req/screens/` e o `.docx` em `req/`.
2. `/load-screens req/screens/` — anexe as imagens no prompt; LLM vision descreve em
   `01-context/screens/<id>.md`.
3. `/plan-from-requirements req/requisito.docx` — o planner referencia IDs de telas no
   comportamento alvo de trilhas Angular.
4. Mesmo fluxo de A) a partir do passo 3.

### C) Prompt curto (sem documento)
1. `/plan-from-prompt "<descrição curta>"`:
   - **Fase A (Perguntas)** — agente levanta lacunas, pergunta em 1-2 rodadas.
   - **Fase B (Critérios de aceite)** — agente propõe CAs; você aprova/rejeita.
   - **Fase C (Plano)** — agente escreve `02-specs/NNN-<slug>/spec.md` + `plan.md`; você
     aprova.
   - **Fase D (Execução)** — só após "aprovado", dispara implementadores.
2. Cada trilha segue fluxo `A) passo 3`.
3. Ao final: idem.

### D) Bug pontual
1. `/sdd-bug-fix <slug-do-bug>`:
   - `regression-author` escreve teste que **reproduz** (red) — `red_confirmed: true`.
   - `<stack>-implementador` corrige causa-raiz.
   - `/tests-run --level=regression --stack=<id>` confirma green.
   - `/tests-run --stack=<id>` roda suíte completa — vizinhança intacta.
   - Report com causa-raiz + caminho do teste de regressão.

## Quando escolher cada command

| Situação | Command |
| --- | --- |
| Decisão de arquitetura em aberto | `/sdd-arquitetura --stack=<id>` |
| Análise de segurança | `/sdd-seguranca --stack=<id>` |
| Revisar entrega isolada (sem SDD todo) | `/sdd-review --stack=<id> <NNN>` |
| Bootstrap/refresh do `01-context/` | `/sdd-context` |
| Escrever teste不在 bug-fix | `/test-add <level> --stack=<id>` |
| Rodar suítes | `/tests-run --stack=<id>` |
| Confere contrato backend ↔ frontend | `/contract-check` |

## Estados da trilha

`STATUS.md` é gerado por `scaffold index --write` e atualizado a cada `new`/`index`. Bloco
`KPIs` no topo: `X abertas | Y bloqueadas | Z prontas`. Verdict é definido pelo `reviewer`
na fase 4:

- `ready` — comportamento alvo inteiro atendido + suíte verde.
- `blocked` — algum check `falta` ou suíte vermelha. Abre follow-up.

`project_sdd/INDEX.md` (~500 tokens, mantido por `memory-curator`) é o cache da memória
viva do projeto — todas as outras sessões consultam antes de mergulhar em `01-context/`.

## Diagrama Mermaid (lifecycle do template)

```mermaid
flowchart LR
  Req[req/*.docx|.png] --> Load[load-requirements + load-screens]
  Load --> Planner[sdd-planner]
  Planner --> Specs[02-specs/NNN-*/spec.md]
  Specs --> Sdd[/sdd per trilha/]
  Sdd --> Impl[fase 3: implementador]
  Sdd --> Review[fase 4: reviewer + tests-run]
  Sdd --> Report[fase 5: context-curator + memory-curator]
  Report --> Index[project_sdd/INDEX.md]
  Specs -.->|bug-fix| Regr[tests-regression]
  Regr --> Run[tests-run regression green]
  Specs -.->|release| Release[tests-release + generate-architecture]
  Release --> DocsArc[docs/architecture/]
  Release --> DocsTest[docs/testing/]
```

## Fluxo recorrente (depois do plano)

1. **Leia `project_sdd/INDEX.md`** (consulta que economiza tokens).
2. **Escolha a próxima trilha aberta** — `STATUS.md` traz abertas/bloqueadas/prontas.
3. **Rode `/sdd --stack=<id> <tipo> <slug>`** — 5 fases.
4. **Após fase 5**: `INDEX.md` é atualizado por `memory-curator`; checa `STATUS.md`.
5. **Quando acabou todas as trilhas do eixo**:
   - `/tests-release --stack=all` — gera plano de testes finais em `docs/testing/`.
   - `/generate-architecture --stack=all` — snapshot em `docs/architecture/`.
   - `/contract-check` — confere contratos backend ↔ frontend.
6. **Próximo eixo**: volta ao passo 1 deste fluxo recorrente.

## Exemplo de referência

`examples/petshop/` — consulta como exercício resolvido:

- `examples/petshop/requisito.md` — entrada (requisito curto)
- `examples/petshop/project_sdd/01-context/requirements.md` — saída esperada do reader
- `examples/petshop/project_sdd/01-context/plan.md` — saída esperada do planner
- `examples/petshop/project_sdd/02-specs/001-*/spec.md` ... `004-*/spec.md` — trilhas
- `examples/petshop/docs/architecture/overview.md` — snapshot de arquitetura
- `examples/petshop/docs/testing/test-plan-frontend-angular.md` — plano de testes
- `examples/README.md` — como navegar pelo exemplo