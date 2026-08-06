import {
  normalizePipelineDefinition,
  validatePipelineDefinition,
  type PipelineDefinition,
} from './pipeline-definition';

/** Pipeline no formato pré-MT-0, como está gravado no banco hoje. */
const legacy: PipelineDefinition = {
  name: 'SDD Enxuto',
  stages: [
    { name: 'Contexto', mode: 'interactive', timeout: 30 },
    { name: 'Merge', mode: 'engine' },
  ],
};

describe('validatePipelineDefinition — retrocompatibilidade (MT-0)', () => {
  it('aceita pipeline legado sem nenhum campo novo', () => {
    expect(() => validatePipelineDefinition(legacy)).not.toThrow();
  });

  it('aceita o formato array puro do Json do banco', () => {
    const def = normalizePipelineDefinition([{ name: 'Contexto' }]);
    expect(def.stages).toHaveLength(1);
    expect(def.kind).toBeUndefined();
  });

  it('continua rebaixando mode "oneshot" para "interactive"', () => {
    const def = normalizePipelineDefinition({ stages: [{ name: 'X', mode: 'oneshot' as any }] });
    expect(def.stages[0].mode).toBe('interactive');
  });

  it('segue exigindo pelo menos um stage com nome único', () => {
    expect(() => validatePipelineDefinition({ stages: [] })).toThrow(/at least one stage/);
    expect(() =>
      validatePipelineDefinition({ stages: [{ name: 'A' }, { name: 'A' }] }),
    ).toThrow(/Duplicate stage name/);
  });
});

describe('normalizePipelineDefinition — campo novo com null não briga o pipeline', () => {
  // Regressão: normalize é o caminho de LEITURA e valida. Se `null` fosse erro,
  // um `{"tags": null}` gravado por qualquer UI tornaria o pipeline impossível de
  // carregar e a sessão não iniciaria.
  it('limpa null no nível do pipeline em vez de lançar', () => {
    const def = normalizePipelineDefinition({
      stages: [{ name: 'A' }],
      kind: null,
      category: null,
      tags: null,
      defaults: null,
    } as any);
    expect('kind' in def).toBe(false);
    expect('tags' in def).toBe(false);
    expect('defaults' in def).toBe(false);
  });

  it('limpa null no nível do stage e preserva os campos válidos', () => {
    const def = normalizePipelineDefinition({
      stages: [{ name: 'A', model: null, skills: null, subagents: ['Plan'], timeout: 30 }],
    } as any);
    const stage = def.stages[0];
    expect('model' in stage).toBe(false);
    expect('skills' in stage).toBe(false);
    expect(stage.subagents).toEqual(['Plan']);
    expect(stage.timeout).toBe(30);
  });

  it('não muta o objeto de entrada ao limpar', () => {
    const input = { stages: [{ name: 'A', model: null }], tags: null } as any;
    normalizePipelineDefinition(input);
    expect(input.tags).toBeNull();
    expect(input.stages[0].model).toBeNull();
  });

  it('tipo errado (não-null) continua sendo erro', () => {
    expect(() => normalizePipelineDefinition({ stages: [{ name: 'A' }], tags: [1] } as any)).toThrow(
      /"tags" must be an array of non-empty strings/,
    );
  });
});

describe('validatePipelineDefinition — campos novos de stage (§1)', () => {
  it('aceita model, cliProfile, subagents e skills', () => {
    expect(() =>
      validatePipelineDefinition({
        stages: [
          {
            name: 'Implementação',
            model: 'opus',
            cliProfile: 'claude',
            subagents: ['Plan', 'Explore'],
            skills: ['sdd'],
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    ['model', 42],
    ['model', ''],
    ['cliProfile', {}],
    ['subagents', 'Plan'],
    ['subagents', [1, 2]],
    ['skills', [null]],
  ])('rejeita stage.%s inválido (%p)', (field, value) => {
    expect(() =>
      validatePipelineDefinition({ stages: [{ name: 'X', [field]: value } as any] }),
    ).toThrow(new RegExp(`Stage "X": "${field}"`));
  });
});

describe('validatePipelineDefinition — campos novos de pipeline (§2)', () => {
  it('aceita kind, category, tags e defaults completos', () => {
    expect(() =>
      validatePipelineDefinition({
        ...legacy,
        kind: 'fixed',
        category: 'sdd-complexo',
        tags: ['backend', 'sdd'],
        defaults: {
          model: 'sonnet',
          cliProfile: 'claude',
          subagents: ['Explore'],
          skills: ['sdd'],
          timeout: 45,
        },
      }),
    ).not.toThrow();
  });

  it('aceita defaults parcial e vazio', () => {
    expect(() => validatePipelineDefinition({ ...legacy, defaults: {} })).not.toThrow();
    expect(() =>
      validatePipelineDefinition({ ...legacy, defaults: { model: 'opus' } }),
    ).not.toThrow();
  });

  it('rejeita kind fora de fixed|custom', () => {
    expect(() => validatePipelineDefinition({ ...legacy, kind: 'shared' as any })).toThrow(
      /"kind" must be one of: fixed\|custom/,
    );
  });

  it('rejeita tags que não são array de string', () => {
    expect(() => validatePipelineDefinition({ ...legacy, tags: [1, 2] as any })).toThrow(
      /"tags" must be an array of non-empty strings/,
    );
    expect(() => validatePipelineDefinition({ ...legacy, tags: 'sdd' as any })).toThrow(
      /"tags" must be an array of non-empty strings/,
    );
  });

  it('rejeita category vazia e não-string', () => {
    expect(() => validatePipelineDefinition({ ...legacy, category: '  ' })).toThrow(
      /"category" must be a non-empty string/,
    );
  });

  it('rejeita defaults que não é objeto', () => {
    expect(() => validatePipelineDefinition({ ...legacy, defaults: [] as any })).toThrow(
      /"defaults" must be a plain object/,
    );
  });

  it.each([
    ['model', 1],
    ['cliProfile', ''],
    ['subagents', 'Explore'],
    ['skills', [{}]],
    ['timeout', 0],
    ['timeout', '45'],
  ])('rejeita defaults.%s inválido (%p)', (field, value) => {
    expect(() =>
      validatePipelineDefinition({ ...legacy, defaults: { [field]: value } as any }),
    ).toThrow(new RegExp(`"defaults"\\.${field}`));
  });
});
