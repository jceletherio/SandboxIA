import { parseLegacyFixedMetadata } from './legacy-fixed-metadata';

describe('parseLegacyFixedMetadata', () => {
  it('reconhece o prefixo e limpa a description', () => {
    const result = parseLegacyFixedMetadata(
      '[fixed · fix-rapido] Implementação → Report → Merge.',
    );
    expect(result).toEqual({
      category: 'fix-rapido',
      description: 'Implementação → Report → Merge.',
    });
  });

  it('é case-insensitive no prefixo e normaliza a categoria em minúsculas', () => {
    const result = parseLegacyFixedMetadata('[FIXED · SDD-Complexo] Fluxo direto.');
    expect(result?.category).toBe('sdd-complexo');
  });

  it('devolve null para description sem o prefixo (pipeline customizada comum)', () => {
    expect(parseLegacyFixedMetadata('Fluxo qualquer sem convenção nenhuma')).toBeNull();
  });

  it('devolve null para description null/undefined/vazia', () => {
    expect(parseLegacyFixedMetadata(null)).toBeNull();
    expect(parseLegacyFixedMetadata(undefined)).toBeNull();
    expect(parseLegacyFixedMetadata('')).toBeNull();
  });

  it('não silencia falso-positivo: prefixo mal formado não casa', () => {
    expect(parseLegacyFixedMetadata('[fixed] sem categoria')).toBeNull();
    expect(parseLegacyFixedMetadata('fixed · fundacao] sem colchete de abertura')).toBeNull();
  });
});
