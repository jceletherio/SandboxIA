---
description: Review + Testes (fase 4 do SDD, em separado). Delega ao agente reviewer (cross-stack) para conferir comportamento alvo contra código com evidência arquivo:linha e rodar suíte existente. Devolve verdict ready|blocked. Use isoladamente quando só precisa revisar uma entrega.
args: [--stack=<id> <NNN> | <spec-path>]
---

Roda só a fase 4 (Review + Testes) do SDD Enxuto sobre uma trilha existente. Útil quando
a implementação foi feita por outra sessão e você quer o veredito antes de merge.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.

## Argumentos

- `$ARGUMENTS` contém `--stack=<id>` seguido do número da trilha `<NNN>` (ex.:
  `--stack=spring 005`) — o reviewer usa a skill da stack indicada.
- Sem `--stack`: o reviewer infere a stack dos arquivos alterados lendo
  `ia-framework/STACK.md` e mapeando raiz→stack.
- Alternativamente, forneça o caminho da spec (`02-specs/005-foo/spec.md`) em vez de `<NNN>`.

## Como conduzir

1. Localize a spec: `02-specs/<NNN>-*/spec.md` ou use o path fornecido. Leia-a para extrair
   o comportamento alvo, contratos, variant e arquivos esperados.
2. Obtenha a lista de arquivos alterados na trilha (via `git diff <base>..<head>` se
   disponível, ou leia a spec + `find` se sem git).
3. **Variante `bug-fix` exige regressão**: se a trilha em review é `bug-fix` e ainda não
   há teste de regressão em `02-specs/<NNN>-*/` ou no diretório de testes da stack,
   dispare `/tests-regression <NNN>` antes do review — o `regression-author` escreve o
   teste que reproduz (red) antes do fix. Sem regressão verde, `verdict` é `blocked`.
4. Delegue ao agente `reviewer`:
   - Passa spec + arquivos alterados + variante.
   - O reviewer lê `ia-framework/STACK.md`, carrega referências da(s) stack(s) tocada(s)
     (`skills/stacks/<stack>/references/`), e aplica o checklist específico.
   - Devolve JSON `reviewer-output.schema.json` com `verdict: ready | blocked`.
5. Apresente o recibo ao usuário. Se `blocked`, liste o que falta (cada item `falta` com
   seu `fix`).
6. Não corrija agora — correção é outra invocação (`/sdd-feature` ou `/sdd-bug-fix` para
   itens pontuais).

## Limitação

Sem runtime vivo:
- Angular: review é estático (template, signals, tokens, aria no markup, testes).
- Postgres: `EXPLAIN ANALYZE` só se harness/db disponível; caso contrário estimamos por
  índices e anti-padrões conhecidos.
- Backend: suíte existente só roda se o usuário pediu explicitamente (não disparar builds
  em sessão SDD sem confirmação).