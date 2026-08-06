---
description: Orquestra escrita de teste de regressão para uma trilha bug-fix existente ou um bug livre. Delega a `regression-author`. Garante que o teste reproduz o bug (red) antes do fix; após correção de outro agente, re-roda com `/tests-run --level=regression` para confirmar green. Não corrige a causa-raiz.
args: <trilha-NNN | "slug" | descrição do bug>
---

Escreve teste de regressão que reproduz bug.

## Quando usar

- Toda trilha SDD variante `bug-fix` com lógica envolvida (não cosmético).
- Bug reportado livremente (sem trilha — pode abrir trilha depois).
- Em conjunto com `/sdd-bug-fix` — passo 3 substitui "teste de regressão obrigatório".

## Quando NÃO usar

- Ajuste cosmético (copy, tooltip) — não há lógica.
- Bug em produção que exige investigação de causa-raiz antes → rode `/sdd` em variante
  `investigation` primeiro.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.

## Condução

1. `$ARGUMENTS` identifica alvo:
   - Trilha existente: `02-specs/<NNN>-<slug>/spec.md`
   - Slug livre: `<slug>` (abbreva)
   - Descrição do bug (texto)
2. **Leia o sintoma**:
   - Da spec da trilha bug-fix (campo "Comportamento alvo" e "Premissas") ou da descrição
     livre (input, esperado, observado).
   - Identifique stack via `STACK.md`+ raiz touched na spec.
3. Delegue ao agente `regression-author`:
   - Captura sintoma → escolhe nível (unit/functional/integration/e2e/pgtap) → escreve
     teste que falha antes do fix → valida red.
   - Devolve JSON com `red_confirmed: true` (mandatório) + path do teste + comando de
     validação.
4. **Apresente recibo ao usuário**:
   - Caminho do teste de regressão.
   - `how_to_validate` — comando para reexecutar.
   - Confirmação `red_confirmed: true/false`.
5. **Próximo passo**:
   - Confirme que o usuário quer prosseguir com o fix (outro agente —
     `<stack>-implementador`):
     - Implementa a correção causa-raiz (não o sintoma).
     - Após fix, rode `/tests-run --level=regression[--stack=<id>]` para confirmar green.
   - Se não, a trilha bug-fix está em red e pronta para o próximo agente; não avance
     sozinho.

## Erros comuns e como orquestrar

- `red_confirmed: false` → `regression-author` reporta que testo não reproduz. Provável:
  - Path não é o culpado — refaça o `grep` em outra camada.
  - Input do bug não-trigger o caminho. Releia o sintoma com usuário.
- Bug depende de estado não-determinístico (rede, tempo) → `regression-author` cria teste
  best-effort + reporta blocker recomendando teste manual.

## Limitação

- Sem Docker/Playwright → Testcontainers/E2E exigem runtime confirmado.
- Bug em fluxo cross-stack entre >1 trilha → abra a trilha bug-fix de nível `multi` ou
  use `/sdd` (decisão em aberto).