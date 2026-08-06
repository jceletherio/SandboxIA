# Spring Boot 3.5 — Segurança

## OWASP Top 10 por item

| Código | Item | Em Spring |
| ------ | ---- | --------- |
| A01 | Broken Access | `@PreAuthorize` em métodos sensíveis, `SecurityFilterChain` com `.anyRequest().authenticated()`, `TenantJwtConverter` lê claim `tenant_id` para isolamento. |
| A02 | Crypto Fail | BCrypt (`PasswordEncoderFactories.createDelegatingPasswordEncoder` com `bcrypt` default; upgrade via `{bcrypt}` prefix). **Nunca** MD5/SHA1. JWK RS256/ES256, rotação com `kid`. |
| A03 | Injection | JPQL/SQL com `:named` params (`@Query("... :tenantId ...")`); DTO records; sem `String.format` para SQL. Native query → bind parameters. `@Query` JPQL protege por padrão quando params são bound. |
| A04 | Insecure Design | Threat modeling na fase 2 de spec. |
| A05 | Security Misconfig | Stack traces `server.error.include-stacktrace=never`; actuator exposure allowlist; CORS allowlist via `WebConfig`; `spring.mvc.throw-exception-if-no-handler-found=true` para 404 não expor routing. |
| A06 | Vuln Deps | OWASP Dependency-Check plugin (`org.owasp:dependency-check-maven`) ou Gradle`s` dependencies check; `dependabot`. |
| A07 | Auth Fail | OAuth2 Resource Server JWT ≤ 15 min; refresh cookie HttpOnly Secure SameSite=Strict; lockout por tenant; rate-limit via Bucket4j ou filter. |
| A08 | Integrity Fail | Webhook signature com `java.security.Signature` HMAC-SHA256 + replay protection via nonce no Redis/Postgres. |
| A09 | Logging | SLF4J com MDC (`tenant_id`, `request_id`); nunca logar PII/secret/Authorization. |
| A10 | SSRF | URL externa: allowlist de hosts; `RestClient` com `redirect: NEVER` ou validado antes de chamar. |

## AuthN — OAuth2 Resource Server JWT

```java
import org.springframework.security.oauth2.jwt.*;

@Bean
public JwtDecoder jwtDecoder(@Value("${jwk.uri}") String jwkUri) {
  NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(jwkUri).build();
  decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
    new JwtTimestampValidator(60),
    new JwtIssuerValidator("https://auth.exemplo.com"),
    new JwtClaimValidator<Map<String,Object>>("tenant_id", Objects::nonNull)
  ));
  return decoder;
}
```

- `kid` rotacional:.publica dois `kid` em paralelo na JWKS durante a janela de sobreposição.
- Reject tokens sem `tenant_id` claim em validator custom.
- Refresh: cookie HttpOnly Secure SameSite=Strict, expiração ≤ 7 dias, rotação.

## Password encoder

```java
@Bean
public PasswordEncoder passwordEncoder() {
  return PasswordEncoderFactories.createDelegatingPasswordEncoder(); // {bcrypt} default
}
```

`matches(raw, encoded)` — comparador internamente `MessageDigest.isEqual` (constante). Não
reimplementar.

## CSRF

Stateless JWT → CSRF disabled. Se usar cookies de sessão, CSRF token via `CookieCsrfTokenRepository`
withHttpOnlyFalse, mesmo para APIs (frontend Angular/React lê `XSRF-TOKEN` cookie → header).

```java
http.csrf(c -> c.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .csrfTokenRequestHandler(new CsrfTokenRequestHandler() {}));
```

## CORS — allowlist

```java
@Bean
public WebMvcConfigurer corsConfigurer() {
  return new WebMvcConfigurer() {
    @Override public void addCorsMappings(CorsRegistry r) {
      r.addMapping("/api/**")
       .allowedOrigins("https://app.exemplo.com")
       .allowedMethods("GET","POST","PUT","PATCH","DELETE")
       .allowedHeaders("Authorization","Content-Type","X-Requested-With")
       .allowCredentials(true);
    }
  };
}
```

Nunca `.allowedOrigins("*")` com `allowCredentials(true)` — Spring bloqueia, mas verifique.

## Rate-limit

Bucket4j coordinating via Redis:

```java
@Bean
public FilterRegistrationBean<RateLimitFilter> rateLimitFilter() {
  Bucket bucket = Bucket.builder().addLimit(limit -> limit.capacity(100).refillGreedy(100, Duration.ofMinutes(1))).build();
  FilterRegistrationBean<RateLimitFilter> reg = new FilterRegistrationBean<>(new RateLimitFilter(bucket));
  reg.addUrlPatterns("/api/*");
  return reg;
}
```

Response header `Retry-After` em `429`. Rota de login override mais baixo.

## Spring Security — detailhes

- `@PreAuthorize` em métodos sensíveis: `@PreAuthorize("@authz.canAccess(authentication, #orderId)")`.
- Injetar `Authentication` em service quando precisa de scopes; controller extrai e passa.
- **Nunca** confiar em `Principal` no service — passa tenant id explícito.

## SQL injection — JPA

- `@Query` JPQL com `:named` params → Spring bind automaticamente.
- Native query → `@Query(value="SELECT ... WHERE tenant_id = :tenantId AND status = :status", nativeQuery=true)`
  com `@Param`. **Sem concatenação**.
- Specification/Criteria API para query dynamic — não use `EntityManager.createQuery` com
  string concatenada.
- `@Query` com `%LIKE%` — o `%` vem como parametro (`%${filter}%` direto é proibido).

## Actuator — não exponha em prod público

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
      base-path: /internal/actuator
  endpoint:
    health:
      show-details: never
```

Proteja `/internal/**` com filtro de rede ou auth separada.

## OpenAPI — não em prod público

```java
@Bean
public OpenAPI openAPI() {
  return new OpenAPI().info(new Info().title("API").version("v1"));
}
```

Springdoc: `springdoc.swagger-ui.enabled=false` em prod. `/v3/api-docs` protegido via
`SecurityFilterChain` (admin scope).

## Logging/MDC

```java
@Component
public class TenantMdcFilter extends OncePerRequestFilter {
  @Override
  protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
    String tenantId = extractTenant(req);
    MDC.put("tenant_id", tenantId);
    MDC.put("request_id", UUID.randomUUID().toString());
    try { chain.doFilter(req, res); } finally { MDC.clear(); }
  }
}
```

- Logback JSON encoder (`net.logstash.logback:logstash-logback-encoder`).
- Não logar fields: `Authorization`, `password`, `token`, `secret`, PII.

## Secrets

- **Não** em `application.yml` commitado. `application-{profile}.yml` só não-segredos.
- Spring Cloud Config/Vault/AWS Secrets Manager via `spring.config.import`.
- `@Value("${DATABASE_URL}")` — env var injetada; nunca hardcoded.
- Testes: `application-test.yml` com valores fake; Testcontainers não usa segredos.

## Virtual threads — armadilhas

- Pinning: `synchronized` em Around-method com IO → virtual thread bloqueada a carrier.
  Prefira `ReentrantLock` se necessário. Não quebre em `HashComputeMap` etc.
- `ThreadLocal` continua funcional — clear no fim da request (filter finally).

## Dependency hygiene

- `mvn org.owasp:dependency-check-maven:check -DfailBuildOnCVSS=7` em CI.
- Bot `dependabot` em GitHub Actions; renovate para enterprise.
- Sem `ManagementFactory`/`Class.forName(userInput)` em runtime.