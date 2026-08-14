---
description: Cria protótipo de telas (Angular, Material Design 3) a partir do documento de requisitos — divisão em partes (P-NNN), design M3 por tela, implementação com dados mockados porém estruturados em interface/gateway pronta para receber o backend definitivo, e revisão de completude contra RF/US. Usa princípios SDD (divisão em partes + revisão). Argumento opcional: escopo/fluxo ou `--part=P-NNN` para rodar só uma parte.
args: [<escopo|--part=P-NNN>]
---

Cria o protótipo de telas em 4 fases (Plano → Design → Implementação → Review), espelhando
o SDD Enxuto: **divisão em partes coesas** e **revisão de completude** contra os requisitos.

## Quando usar

- Requisitos carregados em `01-context/requirements.md` e você quer validar telas/fluxo
  (stakeholder, PO) **antes** do backend existir.
- Documento cita telas sem descrevê-las e não há `.png` para `/load-screens`.
- Você quer um protótipo navegável com dados mockados, mas já **estruturados por contrato**
  para o backend definitivo plugar depois.

## Quando NÃO usar

- Backend definitivo disponível → `/sdd --stack=angular feature <slug>`.
- Documentar telas existentes → `/load-screens`.
- Gerar plano de produção → `/plan-from-requirements`.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` com a stack
> `angular` ativa e `project_sdd/01-context/` existe. Se faltar, pergunte se o usuário quer
> rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se `01-context/requirements.md` não existir, sugira `/load-requirements
> req/<arquivo>` chained antes de prosseguir. Se `frontend/` ainda não tem app Angular
> (sem `package.json`/`angular.json`), pergunte se quer rodar `/setup-tooling --apps`
> chained para criar o skeleton (default) antes do builder; se não, siga só com análise
> estática avisando que `tsc` não roda.

## Condução

1. Carregue `skills/prototyping/SKILL.md` e os references:
   - `skills/prototyping/references/m3-design-system.md`
   - `skills/prototyping/references/mock-data-contract.md`
2. `$ARGUMENTS` opcional: escopo (ex.: "fluxo de pedidos") ou `--part=P-NNN` para rodar
   apenas uma parte já planejada.

### F1 — Plano (divisão em partes)

- Delegue ao agente `prototype-planner`:
  - Lê `01-context/requirements.md` e agrupa os RF/US de face de tela em partes `P-NNN`
    (por fluxo/feature) com dependências e prioridade.
  - Escreve `01-context/prototype/plan.md` (template
    `skills/prototyping/templates/prototype-plan-template.md`).
- Apresente a tabela de partes ao usuário **e confirme em uma rodada** antes de seguir
  (ordem, escopo, lacunas `[AMBIGUO]`).

### F2 — Design (M3 por tela)

- Para cada parte (paralelo se partes disjuntas), delegue ao agente `prototype-designer`:
  - **Consulte o `angular-arquiteto`** (decisão, não código) para a decomposição de
    componentes, rotas lazy e state (signal service) antes de fechar o design.
  - Aplica tokens M3 (cor/tipografia/forma/elevação), componentes M3, estados
    loading/erro/vazio, a11y e o **contrato de dados mockado** (interface `<Domain>Gateway`).
  - Escreve `01-context/prototype/designs/P-NNN-<slug>.md` (template
    `screen-design-template.md`).
- Apresente resumo: designs gerados + contratos definidos + pendências.

### F3 — Implementação (mock estruturado p/ backend)

- Para cada parte, delegue ao agente `prototype-builder`:
  - Implementa em `frontend/src/app/prototype/` componentes standalone + signals + novo
    control flow, consumindo dados **só via interface/token**.
  - Cria `core/api/<domain>.gateway.ts` (interface + DTOs espelhando o backend) e o mock
    (fixtures + latência + erro simulado) — seam de troca registrado no provider.
  - Registra o provider: `{ provide: <TOKEN>, useClass: Mock<Domain>Gateway }`.
  - **Registra a rota**: cria `prototype.routes.ts` (lazy) e a rota raiz `/prototype` no
    `app.routes.ts` (única exceção à regra de rotas globais; template
    `templates/prototype-routes-template.ts`).
- Rode `cd frontend && npx tsc --noEmit` (se o frontend estiver montado) e corrija o que
  aparecer. Não rode `ng serve`/`ng build` em sessão a menos que o usuário autorize.

### F4 — Review (completude + conformidade)

- Para cada parte, delegue ao agente `prototype-reviewer`:
  - Matriz RF/US → telas/estados com evidência `arquivo:linha` (completude).
  - Checklist M3/UX e do contrato do mock (interface pronta para o backend).
  - **Gates Angular** (`validation-gates.md`: `tsc --noEmit`, lint se houver) e **delega o
    check de segurança ao `angular-seguranca`** (critical/high → `blocked`).
  - Escreve `01-context/prototype/review/P-NNN-<slug>.md` (template
    `prototype-review-template.md`).
- Itens `falta` → corrija na mesma parte (ou devolva ao builder). Itens
  `requires_human_validation` → liste para o usuário validar visualmente.

### F5 — Report

- Recibo final:
  - Partes planejadas/desenhadas/implementadas/revisadas + `verdict` de cada uma.
  - **Como plugar o backend**: trocar `Mock<Domain>Gateway` por `Http<Domain>Gateway` no
    provider — componentes intactos (link p/ `references/mock-data-contract.md`).
  - Lacunas `[AMBIGUO]` abertas para o negócio.
- Sugira próximo passo: rodar o protótipo localmente
  (`cd frontend && npm start`, abrir `http://localhost:4200/prototype/...`) para validação
  visual humana; depois `/plan-from-requirements` para as trilhas SDD de produção
  reutilizando os designs.

## Fallback gracioso

- Sem `01-context/screens/` ou sem telas descritas: o `prototype-planner` deriva telas dos
  RF/US e o designer as descreve do zero — sem dependência de `.png`/vision.
- `frontend/` sem app Angular montado: siga com análise estática e `tsc` não roda — reporte
  `how_to_validate`; sugira `/setup-tooling --apps` para montar o app quando o usuário
  quiser validar em browser.

## Não faça

- Não abra trilha SDD de produção nem escreva spec de produção — isso é `/plan-from-requirements` + `/sdd`.
- Não implemente lógica de negócio real no mock (validação/autorização final é backend).
- Não coloque mock em outro lugar que não `frontend/src/app/prototype/` (mantém descartável).
- Não pule a confirmação da F1 — divisão aprovada evita retrabalho de design.
