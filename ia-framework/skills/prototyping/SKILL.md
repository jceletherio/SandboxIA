---
name: prototyping
description: Cria protótipos de telas (frontend Angular) a partir do documento de requisitos em `01-context/requirements.md` — divisão em partes (P-NNN), design seguindo Material Design 3 (m3.material.io), dados mockados via interface/gateway prontos para receber o backend definitivo, e revisão de completude contra os RF/US do documento. Gatilhos: "protótipo de tela", "prototipar telas", "mock de telas", "/prototype-screens".
---

# Prototyping — Protótipo de telas a partir de requisitos

Converte `01-context/requirements.md` (normalizado pelo `requirements-reader`) em um
protótipo navegável de telas Angular com **dados mockados porém estruturados por
contrato**, seguindo **Material Design 3** e as melhores práticas de UI/UX. Não é uma
trilha SDD de produção — é a **fase de validação visual/fluxo** antes ou em paralelo à
implementação definitiva.

## Pipeline

```
01-context/requirements.md ──▶ /prototype-screens
  │
  ├─ F1 prototype-planner      → 01-context/prototype/plan.md   (divisão em partes P-NNN)
  ├─ F2 prototype-designer     → 01-context/prototype/designs/P-NNN-<slug>.md (M3)
  ├─ F3 prototype-builder      → frontend/src/app/prototype/    (components + mock gateway)
  └─ F4 prototype-reviewer     → 01-context/prototype/review/<parte>.md (completude vs RF/US)
```

## Princípios

1. **Divisão em partes (SDD).** As telas são quebradas em partes coesas `P-001`...`P-NNN`
   por fluxo/feature, com dependências e prioridade explícitas (`01-context/prototype/plan.md`).
   Cada parte é revisada isoladamente contra os requisitos que cobre.
2. **Material Design 3 como design system.** Tokens de cor (color roles), tipografia
   (type scale), formas (shape), elevação, componentes e a11y seguem `m3.material.io`.
   Referência em `references/m3-design-system.md`. Toda decisão visual cai em token — sem
   hex solto.
3. **Contrato-first no mock.** O protótipo define uma **interface de API** (gateway) que
   espelha o contrato do backend definitivo; o mock implementa essa interface com fixtures
   e latência artificial. Trocar mock por HTTP real = trocar o provider, nunca o componente.
   Referência em `references/mock-data-contract.md`.
4. **Revisão de completude obrigatória.** Cada RF/US do documento de requisitos é rastreado
   até pelo menos uma tela/estado do protótipo. Sem rastreio → `[AMBIGUO]`/`falta` no review.
   Toda lista tem estado loading/erro/vazio.
5. **Sem regra de negócio no mock.** O mock só devolve fixtures plausíveis; validação final
   continua sendo do backend. O protótipo valida UX e fluxo, não autorização.
6. **Descartável por design.** `frontend/src/app/prototype/` é código de protótipo isolado
   (rota `/prototype/...`), fácil de remover/promover. Nada dele vira "fonte de verdade".

## Integração com a stack Angular

O protótipo é código Angular e respeita a stack do projeto — não é um mundo à parte:

- **Design**: o `prototype-designer` consulta o `angular-arquiteto` para decomposição de
  componentes, rotas lazy e state (decisão), mantendo o visual M3 como decisão própria.
- **Implementação**: o `prototype-builder` segue o fluxo de `skills/stacks/angular/SKILL.md`
  e as references (`arquitetura.md`, `convencoes.md`); decisão de arquitetura no meio →
  consulta o arquiteto.
- **Review**: o `prototype-reviewer` segue o `reviewer` cross-stack, roda os gates de
  `validation-gates.md` (`tsc --noEmit`, lint) e delega o check de segurança ao
  `angular-seguranca` (critical/high → `blocked`).

## Handoff para SDD

Após o protótipo validado, o fluxo de produção **reusa** seus artefatos:

- `/plan-from-requirements` detecta `01-context/prototype/` e pergunta se reusa o
  protótipo. As partes `P-NNN` viram argila das trilhas frontend e os DTOs do mock viram
  o **contrato obrigatório** das trilhas backend (contract-first).
- Regras completas em `references/feeding-sdd.md` (inclui detecção de drift — que não
  bloqueia, vira lacuna/premissa).

## Quando usar

- Você tem requisitos carregados em `01-context/requirements.md` e quer validar telas/fluxo
  antes de abrir trilhas SDD de produção.
- O documento cita telas sem descrevê-las e não há `.png` (ou o vision não está disponível).
- Stakeholder precisa ver o produto antes do backend existir.

## Quando NÃO usar

- Backend definitivo já disponível: rode `/sdd --stack=angular feature <slug>` direto.
- O objetivo é documentar telas já existentes (`/load-screens`) ou produzir spec SDD
  (`/plan-from-requirements`).
- Stack frontend não é Angular (consulte `ia-framework/STACK.md`).
- Só quer o plano de produção sem UX nova: `/plan-from-requirements` já reusa o protótipo
  existente sem re-prototipar.

## Saídas esperadas

| Artefato | Local | Quando |
| --- | --- | --- |
| Plano de partes | `01-context/prototype/plan.md` | F1 |
| Design spec por tela | `01-context/prototype/designs/P-NNN-<slug>.md` | F2 |
| Código do protótipo | `frontend/src/app/prototype/**` | F3 |
| Review de completude | `01-context/prototype/review/P-NNN-<slug>.md` | F4 |

## Setup

Nada a instalar no repo. Requer `project_sdd/01-context/` inicializado (`/init`) e a stack
`angular` ativa em `ia-framework/STACK.md`. Se `frontend/` ainda não tem app Angular,
`/init` cria; senão o builder aponta o gap no recibo.
