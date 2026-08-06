---
name: go
description: Conduz o fluxo SDD Enxuto para Go 1.23+ — módulos, context-first, interfaces no consumer-side, errors.Is/As/%w, errgroup, golangci-lint estrito, pgxpool, http.HandlerFunc, graceful shutdown via signal.Notify. Gatilhos: "API Go", "endpoint Go", "handler Go", "service Go", "/sdd go".
---

# Go 1.23+ — fluxo SDD Enxuto

Spec antes do código, mínimo de cerimônia. Fases gerais em `skills/shared/flow.md`;
detalhes específicos em `references/`.

| Fase | Produz | Fecha quando |
| ---- | ------ | ------------ |
| 1. Contexto | mapa de handlers/services/repos/ports afetados | escopo claro dos pacotes tocados |
| 2. Spec + Tarefas | `02-specs/{NNN}-{slug}/spec.md` com assinaturas Go + endpoints | tarefas executáveis sem adivinhar |
| 3. Implementação | código idiomático + migrations + testes | `go build ./...` + `go test ./...` limpos |
| 4. Review + Testes | verdict `ready \| blocked` com `arquivo:linha` | comportamento alvo bate |
| 5. Report | decisões não óbvias + achados fora de escopo | próxima sessão retoma |

## Princípios Go

1. **Context-first.** Todo handler/service recebe `ctx context.Context` como primeiro
   parâmetro. Cancelamento em cascata via `errgroup`. Sem timeouts hardcoded — config.
2. **Interfaces pequenas, no consumer-side.** Declare interfaces onde consome, não onde
   produz. `type OrderStore interface { Create(ctx, Order) (Order, error) }` no service,
   não no repo.
3. **Errors com `%w` (wrap) ou `errors.Is`/`errors.As`.** Semantic errors in domain via
   sentinel `var ErrConflict = errors.New("conflict")` ou typed `type ConflictError struct{...}`
   com `Error()`/`Is()`. Não `err.Error()` para branching.
4. **Panic só para invariantes de programador.** Input externo → `error`, não `panic`.
   `recover` só em middleware de top level para evitar crash do processo.
5. **Goroutines com cancelamento determinável.** `errgroup.WithContext`, ou goroutine com
   `ctx.Done()` select; canal de saída com `defer close`. Sem goroutine leak.
6. **HTTP.HandlerFunc.** `func(w http.ResponseWriter, r *http.Request)`. Use `chi` ou
   `gin`/`echo` se projeto já adota; senão `net/http` puro com rotas via `http.ServeMux`
   (`http.NewServeMux`, Go 1.22+ com method+pattern).
7. **pgxpool direto.** Sem GORM quando hot path ou para type-safety completa. `sqlc` se
   query-heavy. `database/sql` + `pgx/v5/stdlib` em legados.
8. **`golangci-lint` estrito.** `revive`, `gosec`, `errorlint`, `nilerr`, `bodyclose`,
   `sqlclosecheck`, `rowsclosecheck`. CI falha em warning.
9. **`govulncheck`.** Roda em CI. CVE alto/critical bloqueia merge.
10. **JSON com `encoding/json` + struct tags `omitempty`**. Streaming via `json.Decoder`/
    `json.Encoder` em payloads grandes, nunca `ioutil.ReadAll` seguido de `Unmarshal`.
11. **Configs via env + lib (viper/koanf).** Validate no boot. Missing secret → log Fatal
    só no boot, nunca dentro de request.
12. **Graceful shutdown.** `signal.Notify` + `errgroup` para `srv.Shutdown(ctx)` com
    timeout, drain de `pgxpool`, close de clients HTTP.

## Setup (primeira vez)

1. `SDD_ROOT` (default `./project_sdd`). Árvore ausente →
   `pwsh skills/scaffold.ps1 init <SDD_ROOT>`.
2. `01-context/` vazio → rode `/sdd-context`.
3. Trilha: `pwsh skills/scaffold.ps1 new feature <slug>`.

## As 5 fases (específicas Go)

**1. Contexto.** Mapeie handlers (HttpHandlers/rotas), services, stores/repos, ports
(interfaces de dependência externa: client HTTP, queue, cache), migrations. Ambiguidades:
qual driver HTTP? pgxpool ou sqlc? Sleuth/OpenTelemetry SDK presente? Idempotency?

**2. Spec + Tarefas.** Contratos: assinatura Go `func (s *Service) Create(ctx, Order) (Order,
error)` + endpoint `POST /api/v1/orders` + caminho de erro (`ErrConflict → 409`). Tarefas:
1) migration → 2) store interface + impl → 3) service → 4) handler → 5) test.

**3. Implementação.** Padrões em `references/arquitetura.md`. Não `go run` em main em
sessão SDD — só `go build ./...` para validar. Um commit por task.

**4. Review + Testes.** Delegue ao `reviewer`. `go test ./...`. Teste novo onde lógica é
pura (mappers, validators, domain service com interface de store mockada). Integration
tests com `testcontainers-go` Postgres real (`pgxpool`). Bug-fix exige teste de regressão.

**5. Report.** Decisões: erro sentinela vs typed? `http.ServeMux` puro vs chi? sqlc vs
pgxpool direto? Goroutine por request ou pool? Armadilhas: defer close order, lock contention,
`ctx.Done()` handle lost.

## Regras duras

- **Nunca** `panic` em código de domínio a partir de input externo. Erro retornado.
- **Nunca** `interface{}` sem type switch — use `any` (Go 1.18+) e faça narrow com
  `switch v := x.(type)`.
- **Nunca** `fmt.Errorf("%s", err)` para propagar — use `%w` para wrap e `errors.Is`.
- **Nunca** `_ = json.Unmarshal` — error em parse de payload externo é erro.
- **Nunca** `context.Background()` dentro de handler/service — passou do caller (`ctx`,
  geralmente `r.Context()`)。
- **Nunca** `select` sem `case ctx.Done()` em goroutine de long vida — leak.
- **Nunca** `rows.Close()` esquecido — `defer rows.Close()` sempre.
- **Nunca** `string()` com `[]byte` em hot path (copia). Reusar buffers.
- **Sem** `http.Get`/`http.Post` globais — use `http.Client` com timeout configurado.

## Limitação (declare no recibo)

Sem Postgres nem Redis vivo na sessão SDD. Review é estático (código, tipos, testes).
`go test` só roda na verificação final se solicitado; Testcontainers não roda aqui.