import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrdersView, type OrdersViewProps } from './orders.view';

const base: OrdersViewProps = { vm: { items: [], loading: false, error: null }, onRetry: () => {} };

test('mostra skeleton durante loading', () => {
  render(<OrdersView {...base} vm={{ items: [], loading: true, error: null }} />);
  expect(screen.getByTestId('orders-skeleton')).toBeInTheDocument();
});

test('mostra erro com retry', async () => {
  const onRetry = vi.fn();
  const user = userEvent.setup();
  render(<OrdersView {...base} vm={{ items: [], loading: false, error: new Error('rede') }} onRetry={onRetry} />);
  await user.click(screen.getByRole('button', { name: /tentar novamente/i }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('mostra empty state quando sem dados', () => {
  render(<OrdersView {...base} />);
  expect(screen.getByRole('button', { name: /novo pedido/i })).toBeInTheDocument();
});

test('renderiza itens', () => {
  render(<OrdersView {...base} vm={{ items: [{ id: 'ord-1', total: 12500, status: 'open' }], loading: false, error: null }} />);
  expect(screen.getByText('ord-1')).toBeInTheDocument();
});
