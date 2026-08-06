# Validation gates por stack

Checklist de gates obrigatórios que o `<stack>-implementador` roda antes de devolver
recibo e que o `reviewer` confere antes de `verdict: ready`. Sem um gate passar, o veredito
é `blocked`.

## Angular 22

| Gate | Comando | Quando |
| --- | --- | --- |
| Typecheck | `cd frontend && npx tsc --noEmit` | sempre |
| Lint | `cd frontend && npx ng lint` (ou `eslint .`) | se configurado |
| Unit puro | `cd frontend && npx vitest run --reporter=dot` (somente specs alterados) | se lógica pura |
| Build (release) | `npx ng build --configuration production` | **NÃO rodar em sessão SDD** — CI caret |

**Não rode** `ng serve`/`ng build` em sessão SDD a menos que o chamador autorize
explicitamente. O `tsc --noEmit` cobre 95% dos gates de implementador.

## Node.js 22+

| Gate | Comando | Quando |
| --- | --- | --- |
| Typecheck | `cd backend/nodejs && npx tsc --noEmit` | sempre |
| Lint | `cd backend/nodejs && npx eslint . --max-warnings=0` | se configurado |
| Unit | `cd backend/nodejs && npx vitest run <path>` | se escreveu teste |
| Functional | `cd backend/nodejs && npx vitest run --dir <feature>` | quando inject fake |
| Integration | `RUN_INTEGRATION=1 npx vitest run <path>` | quando toca BD — **requer Docker** |

## Spring Boot 3.5

| Gate | Comando | Quando |
| --- | --- | --- |
| Compile | `cd backend/spring && ./mvnw test-compile -q` (ou `./gradlew compileTestJava`) | sempre |
| Checkstyle | `cd backend/spring && ./mvnw checkstyle:check -q` | se configurado |
| Unit | `cd backend/spring && ./mvnw test -Dtest=<Classe>` (ou `./gradlew test --tests <FQN>`) | se escreveu teste |
| Integration | `./mvnw verify -Dspring.profiles.active=test` | quando toca BD — **requer Docker** |
| OWASP deps | `./mvnw org.owasp:dependency-check-maven:check -DfailBuildOnCVSS=7` | **em CI**; não em SDD |

## Go 1.23+

| Gate | Comando | Quando |
| --- | --- | --- |
| Build | `cd backend/go && go build ./...` | sempre |
| Vet | `cd backend/go && go vet ./...` | sempre |
| Lint | `cd backend/go && golangci-lint run` | se configurado |
| Unit | `cd backend/go && go test -short ./<package>/` | se escreveu teste |
| Integration | `cd backend/go && go test -tags=integration ./<package>/` | quando toca BD — **requer Docker** |
| Vulnerability | `govulncheck ./...` | **em CI**; não em SDD |

## PostgreSQL 16+

| Gate | Comando | Quando |
| --- | --- | --- |
| Syntax | `psql --no-psqlrc -f <migration>.sql --dry-run` (se psql presente) | se escreveu migration |
| pgTAP | `pg_prove -d test_db BD/sql/tests/*.sql` | **requer BD de teste** |
| Schema diff | `migra --schema-only $DATABASE_URL > after.sql && Diffado entre hashes \|走 mencapsulation` | **em CI** |

Migrations SQL em trilha SDD: revise syntax com parse check mental; não há psql em
sessões normalmente.

## Quando o gate falha

1. **Não** declare `feito` no recibo do implementador — `status: bloqueado`.
2. Descreva o erro em `blockers` (uma linha).
3. Não commite — usuário/orquestrador decide后续 ação.

## Quando NÃO rodar (skip com motivo)

- Testcontainers/Playwright: pede confirmação antes de subir Docker.
- Build production completo: custos 30-90s, gera 100MB+; só em CI.
- `mvn dependency-check` / `govulncheck`: pesado, só em CI programado.

Em todos esses casos, reporte `how_to_validate` no recibo e peça ao usuário/orquestrador
rodar manualmente.