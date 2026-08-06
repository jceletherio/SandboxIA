# Convenções de Git (multi-stack)

Conventional Commits + escopo de stack. Um commit por task concluída na fase 3 do SDD.

## Formato

```
<type>(<scope>): <subject>

<body opcional, parágrafo>
```

- `subject` em minúsculas, sem ponto final, ≤ 72 chars, no imperativo.
- `body` explica o **por que**, não o o quê — o diff já mostra o quê.

## Types

| type | uso |
| ---- | --- |
| `feat` | novo comportamento visível ao usuário da stack |
| `fix` | correção de defeito |
| `refactor` | mudança sem alterar comportamento |
| `perf` | mudança de desempenho (índice, query, render path) |
| `docs` | só documentação |
| `test` | só testes |
| `build` | tooling, scripts, configs de build |
| `ci` | pipeline de CI |
| `chore` | misc que não entra acima |

## Scopes por stack

| stack | scope exemplos |
| ----- | -------------- |
| angular | `orders`, `auth`, `router`, `a11y`, `signals` |
| nodejs | `auth`, `users`, `rate-limit`, `observability`, `db` |
| spring | `users`, `security`, `jpa`, `migration`, `actuator` |
| go | `handler`, `service`, `repo`, `middleware`, `px` |
| postgres | `schema`, `rls`, `index`, `partition`, `migration` |

Cross-stack: uma das stacks entre parênteses, a mais impactada.

## Regras duras

- **Nunca** commit sem confirmação explícita do usuário em sessão interativa.
- **Nunca** commit de segredo, `.env`, dump, nem `application-local.yml`.
- **Nunca** `--no-verify` nem pular hooks sem pedir.
- Squash de WIP antes de abrir PR é permitido, mas só quando solicitado.
- Branches: `<stack>/<NNN>-<slug>` (ex.: `postgres/014-tenant-rls`).
- PR: descrição linka a spec (`02-specs/{NNN}-{slug}/spec.md`).