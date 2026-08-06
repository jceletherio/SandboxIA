import { describe, it, expect } from 'vitest';
import { mapOrderToVm, OrderRow, OrderVm } from '<src path>/orders.mapper';

describe('mapOrderToVm (mapper)', () => {
  it('mapeia campos básicos', () => {
    const row: OrderRow = {
      id: '00000000-0000-0000-0000-000000000001',
      external_ref: 'PO-1', status: 'open', tenant_id: 't1', created_at: '2026-08-05T00:00:00Z',
    };
    const vm: OrderVm = mapOrderToVm(row);
    expect(vm).toEqual({
      id: '00000000-0000-0000-0000-000000000001',
      externalRef: 'PO-1',
      status: 'open',
      createdAt: '2026-08-05T00:00:00Z',
    });
  });
});