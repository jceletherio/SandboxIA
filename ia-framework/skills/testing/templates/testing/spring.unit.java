package com.acme.orders;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.*;

@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

  @Mock OrderRepository repo;
  @InjectMocks OrderService service;

  @Test
  void create_conflict_for_duplicate_external_ref() {
    when(repo.existsByExternalRefAndTenantId("PO-1", "t1")).thenReturn(true);

    assertThatThrownBy(() ->
        service.create(new CreateOrderDto("PO-1", "open", java.util.UUID.randomUUID()), "t1"))
      .isInstanceOf(ConflictException.class)
      .hasMessageContaining("external_ref");
  }

  @Test
  void create_persists_when_no_conflict() {
    when(repo.existsByExternalRefAndTenantId(anyString(), anyString())).thenReturn(false);
    when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));

    OrderVm vm = service.create(new CreateOrderDto("PO-1", "open", java.util.UUID.randomUUID()), "t1");

    assertThat(vm.externalRef()).isEqualTo("PO-1");
    verify(repo).save(any(Order.class));
  }
}