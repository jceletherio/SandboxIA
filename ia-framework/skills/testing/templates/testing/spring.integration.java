package com.acme.orders;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest
@Testcontainers
@TestPropertySource(properties = {
  "spring.flyway.locations=classpath:db/migration",
  "spring.jooq.sql-dialect=postgres",
})
class OrderIntegrationTest {

  @Container
  static PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16-alpine")
      .withDatabaseName("test")
      .withReuse(true);

  @DynamicPropertySource
  static void props(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", pg::getJdbcUrl);
    r.add("spring.datasource.username", pg::getUsername);
    r.add("spring.datasource.password", pg::getPassword);
  }

  @Autowired OrderRepository repo;

  @Test
  void insert_and_find_by_tenant() {
    var o = Order.create("t1", "PO-1", OrderStatus.OPEN);
    repo.save(o);
    var found = repo.findByIdAndTenantId(o.getId(), "t1");
    assertThat(found).isPresent();
    assertThat(found.get().getExternalRef()).isEqualTo("PO-1");
  }
}