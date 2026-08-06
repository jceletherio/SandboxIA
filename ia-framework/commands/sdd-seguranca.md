---
description: Análise de segurança de uma stack (frontend Angular, backend NodeJS/Spring/Go, BD Postgres). Delega ao agente <stack>-seguranca. Read-only (não altera código). Use para revisão pré-merge, análise de feature que toca auth/BD/secrets, ou quando uma nova dependência entra no projeto.
args: --stack=<id> [--files=<paths...> | --trilha=<NNN>]
---

Dispara o agente **segurança** da stack escolhida para revisar estática de código e
artefatos, gerando findings OWASP mapeados e verdict ready|blocked.

## Argumentos

- `--stack=<id>` obrigatório. `<id>` ∈ `angular | nodejs | spring | go | postgres`.
- `--files=<paths...>` para apontar arquivos específicos a revisar (ex.: após mudança
  pontual).
- `--trilha=<NNN>` para revisar todos os arquivos alterados da trilha SDD indicada.
- Se nenhum especificado, pergunte.

## Quando usar

- Feature/modificação toca: autenticação, JWT, secrets, BD/RLS/migrations, novas
  dependências (npm/Maven/go mod), CORS, helmet/SecurityFilterChain, ou exibição de HTML
  externo no Angular.
- Pré-merge:peça para auxiliar no go/no-go de segurança.

## Quando NÃO usar

- Para testar runtime (não há browser/cluster vivo aqui) — declare limitações.
- Para substituir o `/sdd-review` (que combina comportamento alvo + testes); use este
  comando quando o foco é só segurança, isolado.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.

## Condução

1. Confirme `--stack=<id>` e o escopo (arquivos ou trilha) em `$ARGUMENTS`.
2. Carregue `skills/stacks/<stack>/references/seguranca.md` e `arquitetura.md`.
3. Liste os arquivos a revisar:
   - `--files`: use o path diretamente.
   - `--trilha`: localize `02-specs/<NNN>-*/spec.md` e extraia a lista de alterados (via
     `git diff` se disponível, ou leia a spec para arquivos alvo).
4. Delegue ao agente `<stack>-seguranca`:
   - Passa arquivos + contexto da stack (libs/frameworks/SDLC relevantes).
   - O agente aplica o checklist OWASP por stack, devolve JSON
     `security-output.schema.json` com `findings` (severity, category, evidence, fix,
     owasp), `verdict` (ready|blocked), `blockers`.
5. Apresente o recibo ao usuário:
   - Findings ordenados por severidade (critical → info).
   - `verdict: blocked` quando há critical/high — liste-os no topo com link `arquivo:linha`.
6. Não corrija aqui — fix é outra invocação (`/sdd-bug-fix` ou `/sdd-feature` para
   remediar). Adicione findings médios/low como backlog (anote em `03-decisions/` se for
   padrão recorrente, ou em issue tracker externo).

## Limitação

Sem toolchain viva (npm/Maven/Go) — dependência-check (npm audit/govulncheck/OWASP
dependency-check) pode não rodar. CVE list émelhor esforço baseado em `package.json`/
`go.mod`/`pom.xml`. Declare isso no recibo e recomende rodar a ferramenta em CI.