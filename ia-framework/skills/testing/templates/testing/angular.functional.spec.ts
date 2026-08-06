import { render, screen } from '@testing-library/angular';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { OrdersComponent } from '<feature path>/orders.component';

describe('OrdersComponent (functional)', () => {
  it('mostra skeleton durante loading', async () => {
    const { fixture } = await render(OrdersComponent, {
      providers: [provideHttpClientTesting()],
      componentInputs: { tenantId: 't1' },
    });
    // httpResource inicia loading; assert skeleton
    expect(screen.getByTestId('orders-skeleton')).toBeTruthy();
  });

  it('mostra estado de erro quando falha', async () => {
    const { fixture } = await render(OrdersComponent, {
      providers: [provideHttpClientTesting()],
      componentInputs: { tenantId: 't1' },
    });
    // dispara request mock falhando via HttpTestingController
    // ...
    expect(await screen.findByText(/erro ao carregar/i)).toBeTruthy();
  });

  it('mostra estado vazio quando lista sem itens', async () => {
    // ...
  });
});