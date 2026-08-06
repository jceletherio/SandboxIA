import {
  assertValidProjectDefaults,
  normalizeProjectDefaults,
  projectDefaultsToConfigLayer,
} from './project-defaults';
import { resolveRuntimeConfig } from './resolve-runtime-config';

describe('normalizeProjectDefaults', () => {
  it('lê o bloco completo do contrato §4', () => {
    const settings = {
      maxSessions: 5,
      defaults: {
        model: 'sonnet',
        masterModel: 'opus',
        permissionMode: 'acceptEdits',
        cliProfile: 'claude',
        skills: ['sdd'],
        subagents: ['Explore'],
        timeout: 45,
      },
    };
    expect(normalizeProjectDefaults(settings)).toEqual(settings.defaults);
  });

  it('devolve {} para settings sem defaults, null, undefined ou tipo errado', () => {
    expect(normalizeProjectDefaults({ maxSessions: 3 })).toEqual({});
    expect(normalizeProjectDefaults(null)).toEqual({});
    expect(normalizeProjectDefaults(undefined)).toEqual({});
    expect(normalizeProjectDefaults({ defaults: [] })).toEqual({});
    expect(normalizeProjectDefaults({ defaults: 'sonnet' })).toEqual({});
  });

  it('nunca lança: descarta campo podre e mantém o resto', () => {
    const out = normalizeProjectDefaults({
      defaults: {
        model: 'sonnet',
        cliProfile: '   ',
        timeout: -1,
        skills: 'sdd',
        subagents: [1, 'Plan', null],
        naoExiste: true,
      },
    });
    expect(out).toEqual({ model: 'sonnet', subagents: ['Plan'] });
  });
});

describe('assertValidProjectDefaults', () => {
  it('aceita patch parcial, vazio e null como remoção', () => {
    expect(() => assertValidProjectDefaults({})).not.toThrow();
    expect(() => assertValidProjectDefaults({ model: 'opus' })).not.toThrow();
    expect(() => assertValidProjectDefaults({ model: null })).not.toThrow();
  });

  it('rejeita campo desconhecido (typo na UI não vira config fantasma)', () => {
    expect(() => assertValidProjectDefaults({ modelo: 'opus' })).toThrow(
      /Unknown "defaults" field: "modelo"/,
    );
  });

  it.each([
    [{ model: 1 }, /"defaults\.model" must be a non-empty string/],
    [{ cliProfile: '  ' }, /"defaults\.cliProfile" must be a non-empty string/],
    [{ skills: 'sdd' }, /"defaults\.skills" must be an array of non-empty strings/],
    [{ subagents: [1] }, /"defaults\.subagents" must be an array of non-empty strings/],
    [{ timeout: 0 }, /"defaults\.timeout" must be a positive number/],
    [{ timeout: '45' }, /"defaults\.timeout" must be a positive number/],
  ])('rejeita %p', (patch, message) => {
    expect(() => assertValidProjectDefaults(patch)).toThrow(message);
  });

  it('rejeita não-objeto', () => {
    expect(() => assertValidProjectDefaults([])).toThrow(/must be a plain object/);
    expect(() => assertValidProjectDefaults(null)).toThrow(/must be a plain object/);
  });
});

describe('projectDefaultsToConfigLayer', () => {
  it('remove masterModel — modelo do Master não vaza para a sessão', () => {
    const layer = projectDefaultsToConfigLayer({ model: 'sonnet', masterModel: 'opus' });
    expect(layer).toEqual({ model: 'sonnet' });
  });

  it('encaixa direto como camada projectDefaults do resolver', () => {
    const defaults = normalizeProjectDefaults({
      defaults: { model: 'sonnet', masterModel: 'opus', skills: ['sdd'], timeout: 45 },
    });
    const { config, provenance } = resolveRuntimeConfig({
      projectDefaults: projectDefaultsToConfigLayer(defaults),
      stage: { model: 'opus' },
    });
    expect(config).toEqual({ model: 'opus', skills: ['sdd'], subagents: [], timeout: 45 });
    expect(provenance).toEqual({ model: 'stage', timeout: 'projectDefaults' });
  });
});
