---
name: testing
description: Adiciona camada de testes ao fluxo SDD Enxuto multi-stack — unitário e funcional na fase 3, integração quando oportuno, regressão em bug-fix, e sistema/aceitação/E2E ao final do desenvolvimento com Playwright/Testcontainers. Orquestra agentes `test-setup`, `test-author` e `regression-author`. Gatilhos: "testar", "Playwright", "Testcontainers", "regressão", "cobertura de testes", "/test-add", "/tests-run", "/tests-release", "/tests-regression", "/tests-setup".
---

# Testes — Camada integrada ao SDD Enxuto

Complementa o SDD normal com níveis de teste adequados a cada fase. Níveis, frameworks por
stack e templates vivem em `references/` e `templates/testing/`.

## Princípios

1. **Cada nível no momento certo.** Teste unitário quando lógica é pura (fase 3 :=
   integrado ao `<stack>-implementador`). Funcional/integração quando a tarefa cobre
   componente/endpoint isolável. Sistema/aceitação/E2E ao **final do desenvolvimento**
   da feature/trilha. Regressão em bug-fix.
2. **Não persiga cobertura.** Não existe meta de %. Foque em: lógica pura + caminhos
   críticos + regressão de bug.
3. **Sem browser/cluster em sessão SDD.** Playwright e Testcontainers exigem runtime
   vivo — `tests-run` pede confirmação antes de disparar Docker/Chromium.
4. **Reaproveite o que o `<stack>-implementador` já escreveu.** Não duplica unit de lógica
   pura; complementa com níveis que ele não escreve.
5. **`/tests-release` ao final do desenvolvimento** — sugerido no prompt final da fase
   5 do `/sdd`. Plano de testes ingressado em `docs/testing/test-plan-<stack>.md`.

## Tipos × Quando (resumo)

| Nível | Fase SDD | Stack exemplos |
| ----- | -------- | -------------- |
| Unitário | 3 — obrigatório p/ lógica pura (implementador) | Vitest/Jest, JUnit5, `testing`, pgTAP |
| Funcional | 3 — quando componente/handler isolável | Testing Library ng, supertest, MockMvc, httptest |
| Integração | 3 — toca BD/IO/contrato (testcontainers) | Testcontainers, `@SpringBootTest`, `app.inject` |
| Sistema | Final — releases | Backend up + health/contrato |
| Aceitação | Final — releases | Playwright (UI), HTTP client (API) |
| E2E | Final — releases | Playwright cross-stack |
| Regressão | Bug-fix — obrigatório reproduzido antes do fix | Mesmo framework do sintoma |

Detalhes em `references/levels.md`. Frameworks por stack em `references/frameworks.md`.
Playwright em `references/playwright.md`.

## Entradas e saídas esperadas

### `/tests-setup [--stack=<id|all>]`
- Cria/ajusta arquivos de configuração de teste (não escreve testes). Saída: lista de
  arquivos criados/alterados + comandos de instalação de deps.

### `/test-add <level> [--stack=<id>] [descrição]`
- `<level>` ∈ `unit|functional|integration|system|acceptance|e2e`.
- Delega a `test-author` (cross-stack) que carrega `skills/stacks/<stack>/references/testing.md`.
- Saída JSON: arquivos criados/alterados + `how_to_validate`.

### `/tests-run [--stack=<id|all>] [--level=<id|all>]`
- Roda as suítes por stack/nível. Pedid confirmação antes de run que exija Docker/cluster.
- Saída: pass/fail + caminho de artefato de trace (Playwright `trace.zip`, JUnit XML).

### `/tests-regression <trilha-ou-bug>`
- Dispara `regression-author`: escreve teste que **reproduz o bug** (red).
- Implementador corrige causa-raiz.
- `/tests-run --level=regression` confirma green.

### `/tests-release [--stack=<id|all>]`
- Dispara `test-author` em níveis final (system+acceptance+e2e) para cada stack ativa.
- Gera `docs/testing/test-plan-<stack>.md` com cenários cobrindo a spec.

## Níveis OBRIGATÓRIOS vs OPCIONAIS por fase

| Fase | OBRIGATÓRIO | OPCIONAL de oportunidade |
| ---- | ----------- | ------------------------ |
| 3 (Implementação) | Unit para lógica pura (implementador) | Funcional p/ componente/endpoint isolável; Integração p/ endpoint c/ BD |
| 4 (Review) | Suíte existente roda; bug-fix exige regressão | (test-author adicionado em review para gap entre expected e actual) |
| 5 (Report) | **Sugestão** no prompt de `/tests-release` | (testes final gerados pelo command em si) |

## Não metas

- Não gera relatório de cobertura métrica (JaCoCo/c8/Istanbul) — não pedido; pode vir depois.
- Não substitui testes unitários do `<stack>-implementador` — ele já escreve; aqui
  complementamos.
- Não roda suites em cada commit automaticamente — operação é CI do projeto.

## Setup inicial

`/tests-setup --stack=all` (uma vez no projeto). Ver `references/frameworks.md` para o que
é instalado por stack. Use os `templates/testing/*.spec.*` como seed quando o `test-author`
não tiver vizinho para copiar padrão.