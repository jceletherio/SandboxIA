# Handoff do protótipo → fluxo SDD (`/plan-from-requirements`)

Como o `sdd-planner` (via `/plan-from-requirements`) consome o protótipo de telas para
gerar as trilhas SDD de produção. Fonte: `01-context/prototype/`.

## Artefatos consumidos

| Artefato | Uso no planejamento |
| --- | --- |
| `01-context/prototype/plan.md` | Decomposição em partes `P-NNN` + RF/US mapeados → argila das trilhas frontend |
| `01-context/prototype/designs/P-NNN-*.md` | Critério de aceite visual (M3, estados, a11y) e contrato `Gateway`/DTOs |
| `01-context/prototype/review/P-NNN-*.md` | Completude já verificada (RF/US → telas) — reuso como evidência |
| `src/frontend/src/app/prototype/core/api/*.gateway.ts` | DTOs reais do mock → "Contratos tocados" das trilhas backend |

## Regras de reuso

1. **Frontend:** 1 parte `P-NNN` pequena = 1 trilha; feature grande → trilhas espelhando
   as partes (com dependência explícita). O bullet de "Comportamento alvo" referencia o
   design spec `P-NNN` (análogo ao `S-NNN` das telas). Não re-projetar UX do zero.
2. **Backend (contract-first):** os DTOs da interface `<Domain>Gateway` do mock são o
   **contrato obrigatório** da trilha backend — o backend entrega exatamente o que o mock
   prometeu (campos, tipos, nullability, enums, formato de erro). Se
   `01-context/api-context.md` existir, validar coerência; divergência vira premissa.
3. **Interação no `/plan-from-requirements`:** o chamador pergunta em 1 rodada
   `[1] Reusar | [2] Ignorar | [3] Re-prototipar`. Este doc assume a escolha `[1]`.

## Detecção de drift (requisitos × protótipo)

Drift **não bloqueia** — vira lacuna/premissa no plano:

| Situação | Tratamento |
| --- | --- |
| RF/US novo em `requirements.md` sem parte `P-NNN` | linha `[AMBIGUO]` no plan ("requisito não prototipado"); trilha planejada por texto + sugestão de `/prototype-screens` para validar depois |
| Parte `P-NNN` cujo RF/US não existe mais em `requirements.md` | marca "protótipo desatualizado (parte X)" e é ignorada no plano |
| Contrato do mock diverge de `api-context.md` | premissa declarada; `reviewer` confere na fase 4 |

## Validação de contrato no release

Quando o backend definitivo nascer, o contrato real deve ser conferido contra o que o
mock prometeu:

- Antes de `api-context.md` ser populado, os **DTOs do mock**
  (`src/frontend/src/app/prototype/core/api/*.gateway.ts`) são a fonte esperada de contrato —
  `/contract-check` deve comparar a API real contra eles.
- Com `api-context.md` publicado, `/contract-check` compara backend real ↔ frontend e o
  elo com o mock vira evidência histórica (se divergir do mock, ajustar o `Http<Domain>Gateway`).
- Divergência mock × real que escapa do review → finding no `contract-checker` e correção
  via `/sdd-feature`/`/sdd-bug-fix`.

## Ciclo recomendado

1. `/plan-from-requirements req/<arquivo>` (detecta protótipo, pergunta reuso).
2. Trilhas geradas: frontend referencia `P-NNN`; backend referencia DTOs do mock.
3. `/sdd --stack=<id> <tipo> <slug>` por trilha — implementador usa o design como aceite.
4. Frontend trilha pode **promover** código do protótipo quando o contrato real plugar
   (trocar `Mock<Domain>Gateway` por `Http<Domain>Gateway` — ver `mock-data-contract.md`).
