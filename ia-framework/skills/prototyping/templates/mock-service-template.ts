// Mock gateway — contrato-first. Espelha a interface que o backend definitivo implementará.
// Remover mock = apagar este arquivo + trocar provider no app config (nunca no componente).

import { Injectable, InjectionToken } from '@angular/core';

// ---- Contrato (espelha API definitiva; não duplicar entre telas) -------------------------

export type OrderStatus = 'open' | 'paid' | 'shipped' | 'cancelled';

export interface Order {
  id: string;
  externalRef: string;
  status: OrderStatus;
  total: number; // centavos
  createdAt: string; // ISO 8601
}

export interface OrderPage {
  items: Order[];
  nextCursor: string | null;
}

export interface OrderListParams {
  status?: OrderStatus;
  cursor?: string;
}

export interface OrderGateway {
  listOrders(params: OrderListParams): Promise<OrderPage>;
  getOrder(id: string): Promise<Order>;
}

export const ORDER_GATEWAY = new InjectionToken<OrderGateway>('OrderGateway');

// ---- Fixtures (dados plausíveis; cobrem dados / vazio / erro) ---------------------------

const ORDERS: Order[] = [
  {
    id: 'ord-8f3a-01',
    externalRef: 'PED-2026-0001',
    status: 'open',
    total: 12500,
    createdAt: '2026-08-10T14:32:00Z',
  },
  // ... mais itens plausíveis
];

const DELAY = { ok: 350, empty: 600, error: 900 };
let shouldFailNext = false;

export function __failNext(): void {
  shouldFailNext = true;
}

async function simulate(delay: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delay));
  if (shouldFailNext) {
    shouldFailNext = false;
    throw new Error('Erro simulado: servidor indisponível');
  }
}

// ---- Implementação mock (substituível por Http<Domain>Gateway sem tocar componentes) -----

@Injectable({ providedIn: 'root' })
export class MockOrderGateway implements OrderGateway {
  async listOrders(params: OrderListParams): Promise<OrderPage> {
    await simulate(DELAY.ok);
    const filtered = params.status
      ? ORDERS.filter((o) => o.status === params.status)
      : ORDERS;
    return { items: filtered, nextCursor: null };
  }

  async getOrder(id: string): Promise<Order> {
    await simulate(DELAY.ok);
    const order = ORDERS.find((o) => o.id === id);
    if (!order) {
      throw new Error('Pedido não encontrado');
    }
    return order;
  }
}

// ---- Seam de troca (onde o provider é registrado) ----------------------------------------
// providers: [{ provide: ORDER_GATEWAY, useClass: MockOrderGateway }]
// backend pronto: [{ provide: ORDER_GATEWAY, useClass: HttpOrderGateway }]
