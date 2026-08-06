import { describe, it, expect } from 'vitest';
import { createOrderRequest } from '<feature path>/dto';

describe('createOrderRequest (validator)', () => {
  it('valida externalRef obrigatório', () => {
    expect(() => createOrderRequest.parse({ externalRef: '', status: 'open' }))
      .toThrowError(/externalRef/i);
  });
  it('aceita status válido', () => {
    expect(createOrderRequest.parse({ externalRef: 'PO-1', status: 'open' }).status)
      .toBe('open');
  });
});