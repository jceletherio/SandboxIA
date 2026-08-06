# Spring Boot 3.5 — Convenções

## Nomeação

- **Controller**: `OrderController`, `@RestController` + `@RequestMapping("/api/v1/orders")`.
- **Service**: `OrderService` (`@Service`), interface `OrderService` + `OrderServiceImpl`
  **só se há multiples impls**. Default: classe concreta.
- **Repository**: `OrderRepository extends JpaRepository<Order, UUID>`. Sem sufixo `Repository`
  em interfaces de domínio不带 JPA.
- **Entity**: `Order`, `OrderItem` — singular. `@Table(name="orders")` (DB plural).
- **DTO**: `CreateOrderDto`, `OrderVm`. `Dto` para entrada, `Vm` para saída. `record`.
- **Exception**: `AppException` base; `ConflictException`, `NotFoundException`,
  `BadRequestException`, `UnauthorizedException` (subclasses).
- **Mapper**: `OrderMapper` interface MapStruct ou classe com métodos static.

## Pacote base

`com.<empresa>.<app>.<dominio>` ex.: `com.acme.shop.orders`. Sub-pacotes: `config`,
`common`, `<dominio>/{controller,service,repository,dto,mapper}` ou feature folders por
domínio (preferido em projetos médios).

## Imports

```java
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import com.acme.shop.orders.dto.CreateOrderDto;
```

Java 21+ — `jakarta.*` (não `javax.*`).

## Builder

Records substituem Builder. Se complexo com defaults, `record Builder` interna ou
MapStruct mapper. Não usar Lombok `@Builder` em records.

## Nullable

- DTOs: campo optativo via `Optional<T>` em retorno de service e `@Nullable` em campo
  de DTO quando null é válido e deve ser distinto de "valor default".
- `Optional` no retorno de service: `Optional<OrderVm>` em `findById`.
- **Não** use `Optional` em field de entidade (JPA não suporta).

## Logging

- SLF4J: `private static final Logger log = LoggerFactory.getLogger(OrderService.class);`
  ou `lombok.@Slf4j` em legados.
- Mensagens estruturadas: `log.info("order created: id={} tenant={}", id, tenantId);` —
  não `log.info("order created: " + id);` (concatenação pula lazy).
- Exceções: `log.error("unhandled", e)` — `e` como último arg, não string.


## Profile

- `application.yml` (default), `application-dev.yml`, `application-prod.yml`.
- Active profile via env `SPRING_PROFILES_ACTIVE=prod`.
- Não há `application-local.yml` em repo (`.gitignore`).

## Testes

- **JUnit 5**, **AssertJ** (`assertThat`), **Mockito**.
- Unit naming: `OrderServiceTest.java` em `src/test/java/.../orders/`.
- Integration: `OrderIntegrationTest.java` + `@SpringBootTest` + `@Testcontainers` +
  `@ServiceConnection` Postgres.
- Maven: `./mvnw test`; Gradle: `./gradlew test`. Wrapper sempre (não assume mvn/gradle globais).
- Testcontainers: `org.testcontainers:postgresql` + `com.github.dasniko:testcontainers-keycloak`
  se JWT necessário.

## Commit

`shared/git-conventions.md`. Scopes: `users`, `orders`, `security`, `jpa`, `migration`,
`actuator`. Exemplo:

```
feat(orders): adiciona endpoint POST /orders com validation e tx no service
```

## Hardlines

- Não rode `mvn spring-boot:run`/`./mvnw spring-boot:run` se servidor vivo em watch.
- Não adicione dependência Maven/Gradle sem ser tarefa explícita (decisão de arquitetura).
- Não rode migrations contra DB de prod em trilha SDD — só `./mvnw flyway:info` para ver.
- Não gere código de MapStruct sem Kardash do plugin no build (gerado como source).