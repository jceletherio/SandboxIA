# Níveis de Teste × Quando

Definição dos níveis e **gatilho preciso** de quando cada nível entra no fluxo SDD.

## Unitário — fase 3, implementador

**O quê:** função/isolado sem dependências externas. Pure by determinismo: mesma input →
mesma output, sem IO.

**Quando é obrigatório no implementador:**
- validators (Angular `ValidatorFn`, Node zod, Spring `@ConstraintValidator`, Go `Validate`)
- pipes/transformadores (Angular pipes, mappers, conversores)
- reducers/`computed` (signal selectors)
- domain service methods com side effects isolados (mock em interfaces)
- parser/formatter (datas, moeda)
- math (cálculo puro — preço, taxa)

**Frameworks:**
- Angular: Vitest (preferido em 22, Karma deprecated) ou Jest. Testing Library p/ componente
  minimamente integrado cont ribado (sub-functional).
- Node: Vitest ou Jest.
- Spring: JUnit 5 + AssertJ. Mockito para mocks (use `@ExtendWith(MockitoExtension.class)`).
- Go: `testing` stdlib. Table-driven. `testify/require` ou assertions via `errors.Is`.
- Postgres: **pgTAP** para função SQL pura.

## Funcional — fase 3, oportunidade

**O quê:** testar uma funcionalidade via boundary público sem subir dependências externas.

**Quando é opportuno (não obrigatório por trilha):**
- Angular: componente isolado usando `TestBed` (Render sem servidor), `httpResource` mock
  por `HttpTestingController` — verifica template coercença (`@if/@for`), bindings,
  state transitions (loading/erro/vazio) sem DOM rendered.
- Node: handler via `app.inject()` (Fastify) ou `supertest` (Express) sem external DB —
  usa fake do repo (in-memory). Verifica contrato HTTP (status + body).
- Spring: `MockMvc` + `@WebMvcTest` para controller layer sem BD real; @MockBean service.
- Go: `httptest.NewServer` + handler com fake store — verifica resposta HTTP.

**Não confunda com Integration:** funcional NÃO toca BD/Redis real — fakes em memória.

## Integração — fase 3, oportunidade

**O quê:** testar com dependências reais (BD, Redis, queue) — não em processo estático.

**Quando é opportuno:**
- Endpoint que cobre regra nova de domínio + constraint nova no BD (FK, CHECK) — verifique
  que a query sob RLS filtro funciona.
- Service que abre transação com lógica rollback (ex.: insert com ON CONFLICT).
- Mudança de schema nova afeta contrato — explora 409/422/412.

**Frameworks:**
- Node: `app.inject()` + Testcontainers Postgres real (via `testcontainers` npm).
- Spring: `@SpringBootTest` + `@Testcontainers` + `@ServiceConnection` (Postgres real).
- Go: `testcontainers-go` Postgres real + `httptest`.
- Postgres: pgTAP invocando migrations via ` Sqitch`/`goose` runner; ou `pgTAP` puro dentro
  do próprio DB para invariantes (`SELECT is( ... , true)`).

**Sempre:** Testcontainers para Postgres real. **Nunca** H2 em testes de repo quando prod
é Postgres — já causou falso-positivo (sintaxe divergente, type `jsonb` ausente).

## Sistema — fase final, em release

**O quê:** backend up completo + dependências reais (BD, Redis); não ataque por browser.

**Quando:** final do desenvolvimento da feature/trilha — pré-release candidate.

**Cobertura obrigatória mínima:**
- Health/Readiness: `GET /actuator/health` (Spring), `GET /health` (Node/Go) → 200.
- Contrato público: cada endpoint público é chamado pelo menos uma vez no caminho feliz.
- Auth: rota protegida sem token → 401; com token inválido → 401; com scope insuficiente → 403.

**Frameworks:**
- `curl`-based smoke tests + assertions em CI; ou Playwright API request context (já disponível
  se Playwright configurado no projeto); ou `newman` (Postman collection).

## Aceitação — fase final, em release

**O quê:** valida critérios de aceite da spec contra o sistema rodando.

**Quando:** pré-release.

**Como:**
- Frontend (Angular): Playwright simula user journey cobrindo critérios da US.
- Backend-only: HTTP client (Playwright API request context, curl, `supertest.run`) cobre
  cada critério de aceite.

**Diferença vs E2E:** aceitação é guiada pela spec (cada cenário = um bullet da seção
"Comportamento alvo"); E2E pode cobrir caminhos não listados (edge cases de UI).

## E2E — fase final, em release

**O quê:** end-to-end real — browser/HTTP client cruzando stacks (Angular → Backend → DB).

**Quando:** pré-release quando há frontend.

**Frameworks:**
- **Playwright** preferido (multi-browser, traces, vídeos, sharding, retries nivelado).
- Cypress em projetos legados (sem tentativa de migração forçada).

## Regressão — bug-fix, obrigatório

**O quê:** teste que **reproduz o bug** antes do fix; após fix, deve passar green.

**Quando:** toda trilha SDD `bug-fix` com lógica envolvida (não cosmético).

**Disciplina:**
1. Captura sintoma: entrar com input X → falha esperada Y.
2. Escreve teste (no nível certo — unit se lógica pura; integration se BD; E2E se
   fluxo cross-stack).
3. Roda teste **antes do fix** — ele deve falhar (red prova que reproduziu).
4. Implementador corrige causa-raiz.
5. Roda teste **depois do fix** — deve passar (green prova que fechou o sintoma).
6. Sempre entra no mesmo commit do fix ou no commit imediatamente seguinte.

Frameworks: mesmo do nível adequado ao sintoma.

## Não cobre (não meta de IA framework)

- Performance/load (`k6`, `JMeter`, `Gatling`) — operação de QE.
- Security scan dinâmico (`zap`, `burp`) — `/sdd-seguranca` cobre estático.
- Mutation testing — fora de escopo.