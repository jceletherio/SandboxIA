**Variante:** feature
**Stack:** spring
**Slug:** products-api

## Comportamento alvo

- [x] `GET /api/v1/products?cursor=...&size=12` → 200 `{ items, nextCursor }` paginação.
- [x] `GET /api/v1/products?search=pipoca` → 200 com items match unaccent(case-insensitive).
- [x] `GET /api/v1/products/{id}` → 200 `ProductVm` | 404 `not_found`.
- [x] Erro padronizado `{ error: { code, message, details } }` em todo status não-2xx.
- [x] JWT required (`@AuthenticationPrincipal Jwt`); `tenant_id` claim puxado e injetado
  em query (`WHERE tenant_id = :tenantId`).

## Contratos tocados

```java
record ProductVm(UUID id, String name, BigDecimal price, String photoUrl, Instant createdAt) {}
record ProductPageVm(List<ProductVm> items, String nextCursor) {}

@GetMapping("/api/v1/products")
ProductPageVm list(@RequestParam(required=false) String search,
                    @RequestParam(defaultValue="12") int size,
                    @RequestParam(required=false) String cursor,
                    @AuthenticationPrincipal Jwt jwt);

@GetMapping("/api/v1/products/{id}")
ProductVm findOne(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt);
```

## Tarefas

1. [ ] spring: `ProductController` + `ProductService` (`@Transactional(readOnly=true)`)
2. [ ] spring: `ProductRepository extends JpaRepository<Product, UUID>` com
   `@Query` JPQL usando `LOWER(p.name) LIKE LOWER(CONCAT('%', :search, '%'))` bind param.
3. [ ] spring: projection record `ProductListItemVm` para evitar N+1 em list.
4. [ ] spring: `TenantJwtConverter` (se ainda não existe — extrair para core/config).
5. [ ] spring: `GlobalExceptionHandler` cobre `NotFoundException`/`BadRequestException`.
6. [ ] spring: integration test `@SpringBootTest + Testcontainers` cobre 200/404/MITM tenant.

## Fora de escopo

- Mutação (`POST/PATCH`) — outra trilha.
- OpenAPI generator — somente manualização em `api-context.md`.

## Premissas assumidas

- Premissa: `Product` entity já existe em `backend/spring/src/main/java/.../catalog/Product.java`
  após trilha `001-products-schema` rodar e gerar entity (mesma trilha gera entity + migration).

## Notas de review

verdict: ready — testcontainers confirma 200/404, isolation tenant works.