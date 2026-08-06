---
name: spring
description: Conduz o fluxo SDD Enxuto para Java 21+ / Spring Boot 3.5 — virtual threads, records, SecurityFilterChain + OAuth2 Resource Server, Bean Validation, Spring Data JPA + Flyway, Micrometer/OTel, Testcontainers. Gatilhos: "API Spring", "endpoint Java", "controller Spring", "serviço Spring Boot", "/sdd spring".
---

# Java 21+ / Spring Boot 3.5 — fluxo SDD Enxuto

Spec antes do código, mínimo de cerimônia. Fases gerais em `skills/shared/flow.md`;
detalhes específicos em `references/`.

| Fase | Produz | Fecha quando |
| ---- | ------ | ------------ |
| 1. Contexto | mapa de controllers/services/repositories/entities afetados | escopo claro das camadas tocadas |
| 2. Spec + Tarefas | `02-specs/{NNN}-{slug}/spec.md` com contratos HTTP + DTOs record | tarefas executáveis sem adivinhar |
| 3. Implementação | código + migration Flyway + testes | `mvn test`/`gradle test` limpos |
| 4. Review + Testes | verdict `ready \| blocked` com `arquivo:linha` | comportamento alvo bate com código |
| 5. Report | decisões não óbvias + achados fora de escopo | próxima sessão retoma |

## Princípios Spring Boot

1. **Virtual threads on.** `spring.threads.virtual.enabled=true`. Bloquear em IO é OK
   (JDBC, HTTP client, query DB) — virtual thread alivia. **Nunca** `synchronized` em volta
   de code blocks dentro de virtual threads (pinning).
2. **Records para DTOs.** `record CreateOrderDto(String externalRef, String status) {}`.
   Java bean getter/setter遗留 → só em código legado isolado.
3. **Bean Validation na borda.** `@Valid` no controller; anotações `@NotBlank`, `@Size`,
   `@Pattern`, `@Email` no record (com `@ConstraintTarget`). Validação complexa em
   `Validator` custom ou service.
4. **`@Transactional` no service.** Não no repository (já transacional por `Repository`
   methods simples), não no controller. Propagação `REQUIRED` default; **nunca** em método
   `private` (proxy não intercepta).
5. **Spring Security 6 stateless.** `SecurityFilterChain` bean funcional + OAuth2 Resource
   Server JWT. Sem `WebSecurityConfigurerAdapter` legado. Sem `@EnableWebSecurity` em
   projetos 3.5 (autoconfigurada ao definir bean).
6. **Spring Data JPA + Flyway.** Migração versionada `V<NN>__slug.sql` em
   `src/main/resources/db/migration/`. **Nunca** editar migration aplicada — nova versão.
   `ddl-auto=validate` em produção (Flyway manda).
7. **N+1 proibido em hot path.** Use `@EntityGraph`, `JOIN FETCH`, ou projection record
   em query derivada/nativa. Maven/Gradle plugin verifica.
8. **OpenAPI com `springdoc-openapi-starter-webmvc-ui` / `webflux`.** Geração automática
   de `/v3/api-docs` e `/swagger-ui`. Não exponha em prod sem auth.
9. **Observabilidade.** Micrometer + OTel + Actuator: `management.endpoints.web.exposure`
   allowlist. Métricas custom via `MeterRegistry`. Alertas por redigir.
10. **Testcontainers para integração.** `@SpringBootTest` + `@Testcontainers` +
    `@Container` Postgres real. Sem H2 em testes de repo se prod é Postgres.
11. **Sem Lombok em código crítico.** Records substituem boilerplate. Lombok esconde debug
    de stack trace e quebra com records. Permitido em DTOs legados quando já распростра.
12. **Secretos fora do repo.** `application-{profile}.yml` só não-segredos; secrets via
    Spring Cloud Config/Vault/KMS/env. `application-local.yml` em `.gitignore`.

## Setup (primeira vez)

1. `SDD_ROOT` (default `./project_sdd`). Árvore ausente →
   `pwsh skills/scaffold.ps1 init <SDD_ROOT>`.
2. `01-context/` vazio → rode `/sdd-context`.
3. Trilha: `pwsh skills/scaffold.ps1 new feature <slug>`.

## As 5 fases (específicas Spring)

**1. Contexto.** Mapeie controllers (URL + método), services (`@Transactional`), entidades
JPA, repositories (`@EntityGraph`/`@Query`), migrations Flyway já aplicadas, beans de
configuração de security. Ambiguidades em bloco: quem valida? Tx boundary? Idempotência via
idempotency-key? Endpoint versionado (`/v1`, `/v2`)?

**2. Spec + Tarefas.** Contratos: signature Java de controller + DTOs record + status code
+ caminho de erro (`@ControllerAdvice` global normaliza). Tarefas: 1) migration Flyway →
2) entity + repository → 3) service → 4) controller + DTO → 5) test.

**3. Implementação.** Padrões em `references/arquitetura.md`. Maven/Gradle wrapper só
necessário para test/compile: `./mvnw test`. Não reinicie o servidor vivo se já em watch.
Um commit por task.

**4. Review + Testes.** Delegue ao `reviewer`. Suíte JUnit 5 + AssertJ/Mockito
(unit/service) + Testcontainers (integration). Teste novo para lógica pura (mapper,
validator custom, domain service com entity em memória). Bug-fix exige teste de regressão.

**5. Report.** Decisões: `@EntityGraph` vs `JOIN FETCH`? Migration additive vs
backfill script? Idempotency-key no service ou filter? Virtual threads: pinning spots?
Armadilhas: ordem de beans, perfil ativo, env var obrigatória.

## Regras duras

- **Nunca** `ddl-auto=update`/`create`/`create-drop` em prod — Flyway manda.
- **Nunca** `@Transactional` em método `private` ou `final` (proxy Spring perde).
- **Nunca** passar `HttpServletRequest` ao service — controller extrai e passa DTO/context.
- **Nunca** concatenar SQL via `String` em `@Query` — bind parâmetros (`:tenantId`).
- **Nunca** `System.out.println` — use SLF4J (`log.info`/`log.error`).
- **Nunca** `@Autowired` field — constructor injection (sem `@Autowired` emrecord-only
  class, lombo caiu).
- **Never** secrets em `application.yml` commitado.
- **Sem** fechar `Stream` com try-with-resources quando stream é finito (`List.stream`).

## Limitação (declare no recibo)

Sem banco nem container vivo na sessão SDD — review é estático (código, anotações, testes).
`mvn test`/`gradle test` só na verificação final se solicitado; Testcontainers não roda aqui.