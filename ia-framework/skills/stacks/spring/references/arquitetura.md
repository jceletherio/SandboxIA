# Spring Boot 3.5 — Padrões de Arquitetura

## Estrutura de pastas

```
backend/spring/
  src/
    main/
      java/<base-pkg>/
        <AppName>.java                 @SpringBootApplication
        config/
          SecurityConfig.java          SecurityFilterChain bean
          JwkConfig.java               jwk store (rotational)
          OpenApiConfig.java            @OpenAPIDefinition info
          WebConfig.java               Cors, converters
          AsyncConfig.java             TaskExecutor virtual
        <dominio>/
          <Dom>Controller.java          @RestController + @RequestMapping("/api/v1/<dom>")
          <Dom>Service.java             @Service + @Transactional boundary
          <Dom>Repository.java          extends JpaRepository ou custom
          <Dom>Entity.java              @Entity + version
          dto/
            Create<Dom>Dto.java        record
            <Dom>Vm.java               record (view model)
          mapper/
            <Dom>Mapper.java            static methods ou MapStruct interface
        common/
          error/
            ApiError.java             record
            GlobalExceptionHandler.java @ControllerAdvice
            AppException.java         base + subclasses
          tenant/
            TenantContext.java         ThreadLocal/aspirational via virtual threads
      resources/
        application.yml                 default não-segredos
        application-prod.yml            profile-specific não-segredos
        db/migration/
          V01__create_orders.sql        Flyway versioned (sem editar posteriormente)
          V02__add_orders_external_ref.sql
    test/
      java/<base-pkg>/
        unit/                           pure logic
        integration/                    @SpringBootTest + Testcontainers
  pom.xml (ou build.gradle)
```

## Controller

```java
@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {
  private final OrderService service;

  public OrderController(OrderService service) { this.service = service; }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public OrderVm create(@Valid @RequestBody CreateOrderDto dto, @AuthenticationPrincipal Jwt jwt) {
    String tenantId = jwt.getClaimAsString("tenant_id");
    return service.create(dto, tenantId);
  }

  @GetMapping("/{id}")
  public OrderVm findOne(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    return service.findOne(id, jwt.getClaimAsString("tenant_id"));
  }
}
```

- Constructor injection (sem `@Autowired` em Spring 4.3+).
- `@Valid` em todo `@RequestBody`/`@RequestPart`.
- `@AuthenticationPrincipal Jwt` — extrair claims, não passar `Jwt` ao service.
- `@ResponseStatus` no método; erro via `@ControllerAdvice`.

## DTOs — records

```java
public record CreateOrderDto(
    @NotBlank @Size(max = 64) String externalRef,
    @NotBlank @Pattern(regexp = "open|paid|shipped") String status,
    @NotNull UUID customerId
) {}

public record OrderVm(UUID id, String externalRef, String status, Instant createdAt) {}
```

- Tornar campos nullable em DTOs explícitos: preferir `Optional` em retorno de service e
  DTO com nullable marcado por `@Nullable` em javadoc.
- Sem getter/setter — record é imutável.

## Service + transação

```java
@Service
public class OrderService {
  private final OrderRepository repo;
  private final OrderMapper mapper;

  public OrderService(OrderRepository repo, OrderMapper mapper) {
    this.repo = repo; this.mapper = mapper;
  }

  @Transactional
  public OrderVm create(CreateOrderDto dto, String tenantId) {
    if (repo.existsByExternalRefAndTenantId(dto.externalRef(), tenantId)) {
      throw new ConflictException("external_ref", dto.externalRef());
    }
    Order order = mapper.toEntity(dto, tenantId);
    return mapper.toVm(repo.save(order));
  }

  @Transactional(readOnly = true)
  public OrderVm findOne(UUID id, String tenantId) {
    return repo.findByIdAndTenantId(id, tenantId)
        .map(mapper::toVm)
        .orElseThrow(() -> new NotFoundException("order", id));
  }
}
```

- `@Transactional` no método público. Read-only methods `@Transactional(readOnly=true)`.
- Exceções de domínio (custom, unchecked) — rollback default; não capturar para esconder.
- **Nunca** capturar em service para retornar null — vira `Optional` ou throw.

## Repository — N+1 evitado

```java
public interface OrderRepository extends JpaRepository<Order, UUID> {
  boolean existsByExternalRefAndTenantId(String externalRef, String tenantId);

  Optional<Order> findByIdAndTenantId(UUID id, String tenantId);

  @EntityGraph(attributePaths = {"items", "customer"})
  List<Order> findAllByTenantIdAndStatus(String tenantId, String status, Pageable pageable);

  @Query("""
      select new com.app.orders.dto.OrderListItemVm(o.id, o.externalRef, o.status, o.createdAt)
      from Order o
      where o.tenantId = :tenantId
      order by o.createdAt desc
      """)
  List<OrderListItemVm> listProjections(@Param("tenantId") String tenantId, Pageable pageable);
}
```

- Use projection record (`new com.app...Dto(...)`) para listagens (evita carregar entidade).
- `@EntityGraph` para carregar associações necessárias sem N+1.
- Derived query limita número de `And` — acima de 4, dividir em `@Query` JPQL.

## Entity — imutável campos sensíveis

```java
@Entity
@Table(name = "orders", indexes = {
  @Index(name = "ix_orders_tenant_external", columnList = "tenant_id, external_ref", unique = true)
})
public class Order {
  @Id @GeneratedValue
  private UUID id;
  @Version
  private long version;          // optimistic locking
  @Column(name = "tenant_id", nullable = false)
  private String tenantId;
  @Column(name = "external_ref", nullable = false, length = 64)
  private String externalRef;
  @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16)
  private OrderStatus status;
  @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
  private Set<OrderItem> items = new HashSet<>();

  // protected no-arg construtor para JPA; factory methods públicos
  protected Order() {}

  public static Order create(String tenantId, String externalRef, OrderStatus status) {
    Order o = new Order();
    o.tenantId = tenantId; o.externalRef = externalRef; o.status = status;
    return o;
  }
  // getters somente; mutação via métodos de domínio (addItem, etc.) — sem setters
}
```

- `@Version` para optimistic locking. Sem setters público que escondam invariantes.
- `@Enumerated(EnumType.STRING)` — nunca ordinal.
- FKs via `@ManyToOne(fetch = LAZY)` default; eager só em casos provados.

## Migration Flyway

```sql
-- V02__add_orders_external_ref.sql
ALTER TABLE orders
  ADD COLUMN external_ref VARCHAR(64) NOT NULL DEFAULT '';

CREATE UNIQUE INDEX ix_orders_tenant_external
  ON orders (tenant_id, external_ref);
```

Regras:

- `V<NN>__<slug>.sql` — SQL maiúsculas? Convenção do projeto. Snake_case no slug.
- **Não editar** migration aplicada em ambiente (staging/prod). Nova `V03__...` para
  alterations.
- Destructive (`DROP COLUMN`): script de backfill como `V03_1__backfill.sql` separado.
- `validateOnMigrate=true` em application.yml — robusto.

## Global exception handler

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ApiError> handle(MethodArgumentNotValidException e) {
    List<ApiError.FieldError> fields = e.getBindingResult().getFieldErrors().stream()
        .map(fe -> new ApiError.FieldError(fe.getField(), fe.getDefaultMessage()))
        .toList();
    return ResponseEntity.badRequest().body(new ApiError("bad_request", "Validation failed", fields));
  }

  @ExceptionHandler(ConflictException.class)
  public ResponseEntity<ApiError> handle(ConflictException e) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(new ApiError("conflict", e.getMessage(), e.getDetails()));
  }

  @ExceptionHandler(NotFoundException.class)
  public ResponseEntity<ApiError> handle(NotFoundException e) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(new ApiError("not_found", e.getMessage(), e.getDetails()));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiError> handle(Exception e) {
    log.error("unhandled", e);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(new ApiError("internal", "Unexpected error"));
  }
}
```

Server prod: `server.error.include-stacktrace=never` no `application-prod.yml`.

## Security Filter Chain

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

  @Bean
  public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
      .csrf(csrf -> csrf.disable())  // stateless JWT
      .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
      .authorizeHttpRequests(reg -> reg
          .requestMatchers("/actuator/health", "/actuator/info").permitAll()
          .requestMatchers("/api/v1/auth/**").permitAll()
          .anyRequest().authenticated()
      )
      .oauth2ResourceServer(c -> c.jwt(j -> j.jwtAuthenticationConverter(new TenantJwtConverter())));
    return http.build();
  }
}
```

`TenantJwtConverter` lê claim `tenant_id` e `scopes`; cria `JwtAuthenticationToken` com
authorities mapeados de scopes (`SCOPE_orders:write`). `@PreAuthorize("hasAuthority('SCOPE_orders:write')")`
opcional.

## Application config

```yaml
spring:
  threads:
    virtual:
      enabled: true
  datasource:
    url: ${DATABASE_URL}
    hikari:
      maximum-pool-size: 20
  jpa:
    hibernate:
      ddl-auto: validate
    properties:
      hibernate:
        jdbc.time_zone: UTC
  flyway:
    enabled: true
    locations: classpath:db/migration
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
server:
  error:
    include-stacktrace: never
    include-message: never
```

## Não faça

- `@Transactional` em `private` (proxy perdido).
- `cascade = CascadeType.REMOVE` em coleção grande (RM por linha) — `orphanRemoval=true`
  preferido para composição, e remoção por repo explicita senão.
- `@OneToMany` sem `mappedBy` (join table intermediário indesejado).
- `@Query` com `+` ou `String.format` para montar SQL — bind params `:name`.
- `System.out.println`. Use SLF4J.
- `RestTemplate` em Spring 3+ — use `RestClient` ou `WebClient`.