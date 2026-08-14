---
title: Review de Completude — <nome da tela/parte>
part_id: P-NNN
requirements: [RF-ID, US-ID]
reviewer: prototype-reviewer
updated: <data>
kpis: { health: green }
---

# Review de Completude — P-NNN <slug>

> Gerado por `prototype-reviewer` (F4 do `/prototype-screens`). Confere **atendimento aos
> requisitos** e **conformidade M3/UX** do protótipo implementado.

## Matriz de completude (requisito → protótipo)

| Requisito | Evidência (arquivo:linha) | Status |
| --- | --- | --- |
| RF-12 | `frontend/src/app/prototype/orders/orders.component.html:24` | ok |
| US-03 | ... | falta |

`ok` = atendido com evidência. `falta` = não atendido, com `fix` objetivo. Item visual que
não dá para confirmar estaticamente → `requires_human_validation`.

## Conformidade M3 / UX

- [ ] Cores só via tokens (sem hex solto) — evidência
- [ ] Type scale M3, shapes do scale
- [ ] Estados loading / erro / vazio presentes (todo @for tem @empty/@error)
- [ ] Touch target ≥ 48dp; contraste AA
- [ ] Nada comunicado só por cor (ícone+texto+aria)
- [ ] Ações hierarquizadas (1 filled por área)
- [ ] a11y: labels/roles/`track` em @for

## Contrato do mock

- [ ] Componente depende da interface + token (sem import do mock)
- [ ] DTOs centralizados em `core/api/`; nomes/tipos espelham backend
- [ ] Fixtures cobrem dados / vazio / erro

## Verdict

- `ready` — todos os requisitos da parte atendidos e conformidade M3 ok.
- `blocked` — algum `falta` (correção em `fix`) ou conformidade pendente.

## Achados fora de escopo

- <notas que viram backlog, não conserto agora>

## Não coberto (requer validação humana)

- <itens visuais/runtime que o review estático não confirma>
