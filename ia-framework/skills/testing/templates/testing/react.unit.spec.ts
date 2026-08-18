import { describe, it, expect } from 'vitest';
import { formatTotal } from '@/shared/lib/format';

describe('formatTotal', () => {
  it('formata centavos para reais', () => {
    expect(formatTotal(12500)).toBe('R$ 125,00');
  });

  it('retorna placeholder para valor inválido', () => {
    expect(formatTotal(NaN)).toBe('—');
  });
});
