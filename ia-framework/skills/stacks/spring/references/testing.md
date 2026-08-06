# Spring Boot — Testing

## Stack atual

- **Java 21+ / Spring Boot 3.5**. Records DTOs. Bean Validation. JPA + Flyway. Spring
  Security 6 stateless JWT.

## Níveis × Frameworks

| Nível | Framework | Notas |
| ----- | --------- | ----- |
| Unitário | JUnit 5 + AssertJ + Mockito | Service methods com `@Mock` repos. Mappers estáticos. `Validator` custom. |
| Funcional | `@WebMvcTest` + `MockMvc` + `@MockBean` | Controller slice; valida HTTP 400/409/401 shape sem BD. |
| Integração | `@SpringBootTest` + Testcontainers | BD real Postgres; valida tx, FK, RLS, `@Transactional`. |
| Sistema | Actuator + curl/Playwright API | `GET /actuator/health` UP; rota pública com 401/403 sem auth. |
| Aceitação | Playwright API request context | Cenários da spec viram HTTP calls. |
| E2E | Playwright (se frontend) | UI cross-stack. |

## Setup do projeto

`test-setup` adicionará ao `pom.xml`/`build.gradle`:
- `org.springframework.boot:spring-boot-starter-test` (já vem em Boot starter)
- `org.testcontainers:junit-jupiter`
- `org.testcontainers:postgresql`
- `com.github.dasniko:testcontainers-keycloak` (se JWT validation necessita de IdP)

Arquivos:
- `src/test/resources/application-test.yml` (desativa Actuator, logs verbosos se quiser).
- `src/test/java/.../TestApplication.java` (mesma `@SpringBootApplication` em test).

## Unitário — boilerplate

```java
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {
  @Mock OrderRepository repo;
  @InjectMocks OrderService service;

  @Test
  void create_with_existing_external_ref_throws_conflict() {
    when(repo.existsByExternalRefAndTenantId("PO-1", "t1")).thenReturn(true);

    assertThatThrownBy(() ->
        service.create(new CreateOrderDto("PO-1", "open", UUID.randomUUID()), "t1"))
      .isInstanceOf(ConflictException.class);

    verify(repo, never()).save(any());
  }
}
```

## Funcional — `@WebMvcTest`

```java
@WebMvcTest(OrderController.class)
@Import(GlobalExceptionHandler.class)
class OrderControllerTest {
  @Autowired MockMvc mvc;
  @MockBean OrderService service;

  @Test
  void post_invalid_returns_400() throws Exception {
    mvc.perform(post("/api/v1/orders")
        .contentType(APPLICATION_JSON).content("{}"))
      .andExpect(status().isBadRequest())
      .andExpect(jsonPath("$.error.code").value("bad_request"));
  }

  @Test
  void post_conflict_returns_409() throws Exception {
    when(service.create(any(), anyString()))
      .thenThrow(new ConflictException("external_ref", "dup"));
    mvc.perform(post("/api/v1/orders")
        .contentType(APPLICATION_JSON)
        .content("""{"externalRef":"dup","status":"open","customerId":"00000000-0000-0000-0000-000000000001"}"""))
      .andExpect(status().isConflict());
  }
}
```

## Integração — `@SpringBootTest` + Testcontainers

```java
@SpringBootTest
@Testcontainers
class OrderIntegrationTest {
  @Container @ServiceConnection
  static PostgreSQLContainer<?> pg =
      new PostgreSQLContainer<>("postgres:16-alpine").withReuse(true);

  @Autowired OrderRepository repo;

  @Test
  void insert_and_find_by_tenant() {
    var o = Order.create("t1", "PO-1", OrderStatus.OPEN);
    repo.save(o);
    assertThat(repo.findByIdAndTenantId(o.getId(), "t1")).isPresent();
  }

  @Test
  void unique_constraint_on_external_ref() {
    repo.save(Order.create("t1", "PO-X", OrderStatus.OPEN));
    assertThatThrownBy(() ->
        repo.save(Order.create("t1", "PO-X", OrderStatus.OPEN)))
      .isInstanceOf(DataIntegrityViolationException.class);
  }
}
```

## RLS em Testcontainers

Spring Testcontainers não executa `SET LOCAL app.tenant_id` automaticamente. Para validar
RLS, abra JDBC e execute `SET LOCAL app.tenant_id = '<uuid>'` dentro da sessão. Alternativa:
`@TestPropertySource` com chave `app.tenant_id` lida por Filter adicionado no teste.

## Bug-fix regressão

Reproduza no nível certo:
- Domain logic (service, mapper) → unit.
- Controller contract (status, body error shape) → `@WebMvcTest`.
- Repository / JPA N+1 / migration → `@SpringBootTest` + Testcontainers.

Após fix:
- `./mvnw test -Dtest=<Classe>` deve passar green.
- Em bug de JPA: escreva antes do fix um teste que carrega a query problemática (N+1) com
  `Hibernate-statistics` habilitado pra contar queries.

## Não faça

- Não use H2 em testes de repository quando prod é Postgres — `jsonb` divergente.
- Não crie `src/test/java/.../ApplicationTests.java` risco — use slice (`@WebMvcTest`,
  `@DataJpaTest`) por default; integração total só quando precisa de comportamento end-to-end.
- Não `printStackTrace()` em test — use AssertJ `assertThat` chaining; logs via SLF4J.