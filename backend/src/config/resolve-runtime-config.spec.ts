import {
  describeProvenance,
  resolveRuntimeConfig,
  type RuntimeConfigInput,
} from './resolve-runtime-config';

describe('resolveRuntimeConfig', () => {
  it('devolve config vazia (listas presentes) quando não há nenhuma camada', () => {
    const { config, provenance } = resolveRuntimeConfig({});
    expect(config).toEqual({ subagents: [], skills: [] });
    expect(provenance).toEqual({});
  });

  it('aplica a precedência env < projectDefaults < pipelineDefaults < stage < sessionOverride', () => {
    const input: RuntimeConfigInput = {
      env: { model: 'haiku', cliProfile: 'env-cli', permissionMode: 'plan', timeout: 10 },
      projectDefaults: { model: 'sonnet', cliProfile: 'claude', timeout: 45 },
      pipelineDefaults: { model: 'sonnet', timeout: 60 },
      stage: { model: 'opus', permissionMode: 'acceptEdits' },
      sessionOverride: { timeout: 90 },
    };

    const { config, provenance } = resolveRuntimeConfig(input);

    expect(config.model).toBe('opus');
    expect(config.cliProfile).toBe('claude');
    expect(config.permissionMode).toBe('acceptEdits');
    expect(config.timeout).toBe(90);
    expect(provenance).toEqual({
      model: 'stage',
      cliProfile: 'projectDefaults',
      permissionMode: 'stage',
      timeout: 'sessionOverride',
    });
  });

  it('sessionOverride vence todas as camadas nos escalares', () => {
    const { config, provenance } = resolveRuntimeConfig({
      env: { model: 'haiku' },
      projectDefaults: { model: 'sonnet' },
      pipelineDefaults: { model: 'sonnet' },
      stage: { model: 'opus' },
      sessionOverride: { model: 'fable' },
    });
    expect(config.model).toBe('fable');
    expect(provenance.model).toBe('sessionOverride');
  });

  it('ignora camadas intermediárias ausentes sem perder as mais fracas', () => {
    const { config, provenance } = resolveRuntimeConfig({
      projectDefaults: { model: 'sonnet', cliProfile: 'claude' },
      stage: { model: 'opus' },
    });
    expect(config).toEqual({
      model: 'opus',
      cliProfile: 'claude',
      subagents: [],
      skills: [],
    });
    expect(provenance).toEqual({ model: 'stage', cliProfile: 'projectDefaults' });
  });

  describe('listas', () => {
    it('faz união deduplicada preservando a ordem fraco -> forte', () => {
      const { config } = resolveRuntimeConfig({
        env: { skills: ['qmd-skill'] },
        projectDefaults: { skills: ['sdd', 'qmd-skill'], subagents: ['Explore'] },
        pipelineDefaults: { skills: ['sdd-feature'] },
        stage: { skills: ['sdd'], subagents: ['Plan', 'Explore'] },
        sessionOverride: { subagents: ['sdd-reviewer'] },
      });

      expect(config.skills).toEqual(['qmd-skill', 'sdd', 'sdd-feature']);
      expect(config.subagents).toEqual(['Explore', 'Plan', 'sdd-reviewer']);
    });

    it('não substitui: uma skill do projeto sobrevive a um stage com outra skill', () => {
      const { config } = resolveRuntimeConfig({
        projectDefaults: { skills: ['sdd'] },
        stage: { skills: ['dataviz'] },
      });
      expect(config.skills).toEqual(['sdd', 'dataviz']);
    });

    it('não expõe listas no provenance (não têm origem única)', () => {
      const { provenance } = resolveRuntimeConfig({
        stage: { skills: ['sdd'], subagents: ['Plan'] },
      });
      expect(provenance).toEqual({});
    });

    it('dedup é por valor exato e a primeira ocorrência define a posição', () => {
      const { config } = resolveRuntimeConfig({
        env: { skills: ['a', 'b', 'a'] },
        stage: { skills: ['b', 'c'] },
      });
      expect(config.skills).toEqual(['a', 'b', 'c']);
    });
  });

  describe('entrada suja (Json do banco / env var vazia)', () => {
    it('trata string vazia, whitespace e null como AUSENTE — camada mais fraca válida ganha', () => {
      const { config, provenance } = resolveRuntimeConfig({
        env: { model: 'haiku' },
        projectDefaults: { model: '   ' },
        pipelineDefaults: { model: null as any },
        stage: { model: '' },
      });
      expect(config.model).toBe('haiku');
      expect(provenance.model).toBe('env');
    });

    it('faz trim nos escalares e nos itens de lista', () => {
      const { config } = resolveRuntimeConfig({
        stage: { model: '  opus  ', skills: [' sdd ', '  '] },
      });
      expect(config.model).toBe('opus');
      expect(config.skills).toEqual(['sdd']);
    });

    it('descarta timeout não positivo, NaN e não-numérico', () => {
      for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '45' as any, null as any]) {
        const { config, provenance } = resolveRuntimeConfig({
          projectDefaults: { timeout: 45 },
          stage: { timeout: bad },
        });
        expect(config.timeout).toBe(45);
        expect(provenance.timeout).toBe('projectDefaults');
      }
    });

    it('descarta lista que não é array e itens não-string', () => {
      const { config } = resolveRuntimeConfig({
        projectDefaults: { skills: 'sdd' as any },
        stage: { subagents: [1, null, 'Plan'] as any },
      });
      expect(config.skills).toEqual([]);
      expect(config.subagents).toEqual(['Plan']);
    });

    it('não muta as camadas de entrada', () => {
      const projectDefaults = { skills: ['sdd'] };
      const { config } = resolveRuntimeConfig({ projectDefaults, stage: { skills: ['dataviz'] } });
      expect(projectDefaults.skills).toEqual(['sdd']);
      expect(config.skills).not.toBe(projectDefaults.skills);
    });
  });

  it('aceita um PipelineStage inteiro como camada (campos extras ignorados)', () => {
    const stage = {
      name: 'Implementação',
      mode: 'interactive' as const,
      promptTemplate: 'faça X',
      model: 'opus',
      skills: ['sdd'],
    };
    const { config } = resolveRuntimeConfig({ stage });
    expect(config).toEqual({ model: 'opus', subagents: [], skills: ['sdd'] });
  });
});

describe('describeProvenance', () => {
  it('descreve escalares com a camada de origem e listas com os itens finais', () => {
    const resolution = resolveRuntimeConfig({
      projectDefaults: { cliProfile: 'claude' },
      stage: { model: 'opus', skills: ['sdd'] },
    });
    expect(describeProvenance(resolution)).toBe(
      'cliProfile=claude (projectDefaults), model=opus (stage), skills=[sdd]',
    );
  });

  it('devolve string vazia quando não há nada resolvido', () => {
    expect(describeProvenance(resolveRuntimeConfig({}))).toBe('');
  });
});
