import { applyFixedStageRuntime } from './fixed-stage-runtime';
import { PipelineDefinition, validatePipelineDefinition } from './pipeline-definition';

const sddEnxuto = (): PipelineDefinition => ({
  kind: 'fixed',
  category: 'sdd-complexo',
  permissions: ['Bash(pnpm build:*)'],
  stages: [
    { name: 'Contexto', mode: 'interactive' },
    { name: 'Spec + Tarefas', mode: 'interactive' },
    { name: 'Implementação', mode: 'interactive' },
    { name: 'Review + Testes', mode: 'interactive' },
    { name: 'Report', mode: 'interactive' },
    { name: 'Merge', mode: 'engine' },
  ],
});

describe('applyFixedStageRuntime', () => {
  it('semeia subagents/skills pelos nomes de estágio das pipelines fixas', () => {
    const { definition, changed } = applyFixedStageRuntime(sddEnxuto());
    expect(changed).toBe(true);
    const byName = Object.fromEntries(definition.stages.map((s) => [s.name, s]));
    expect(byName['Contexto'].subagents).toEqual(['qmd-curator']);
    expect(byName['Contexto'].skills).toEqual(['qmd-skill']);
    expect(byName['Spec + Tarefas'].skills).toEqual(['sdd']);
    expect(byName['Implementação'].subagents).toEqual(['sdd-implementer', 'frontend-designer']);
    expect(byName['Review + Testes'].subagents).toEqual(['sdd-reviewer']);
    expect(byName['Report'].subagents).toEqual(['sdd-context-curator']);
  });

  it('não toca no estágio Merge (mode engine, não sobe CLI)', () => {
    const { definition } = applyFixedStageRuntime(sddEnxuto());
    const merge = definition.stages.find((s) => s.name === 'Merge');
    expect(merge).toEqual({ name: 'Merge', mode: 'engine' });
  });

  it('preserva o resto da definição, incluindo a allowlist de permissions', () => {
    const { definition } = applyFixedStageRuntime(sddEnxuto());
    expect(definition.permissions).toEqual(['Bash(pnpm build:*)']);
    expect(definition.kind).toBe('fixed');
    expect(definition.category).toBe('sdd-complexo');
  });

  it('gera definição que passa na validação do contrato', () => {
    const { definition } = applyFixedStageRuntime(sddEnxuto());
    expect(() => validatePipelineDefinition(definition)).not.toThrow();
  });

  it('é idempotente: segunda passada não muda nada', () => {
    const first = applyFixedStageRuntime(sddEnxuto());
    const second = applyFixedStageRuntime(first.definition);
    expect(second.changed).toBe(false);
    expect(second.definition).toBe(first.definition);
  });

  /**
   * O caso que motivou a idempotência por pipeline inteira: a UI grava campo
   * vazio como AUSENTE, então um seed por estágio ressuscitaria no boot seguinte
   * o subagente que o usuário acabou de tirar.
   */
  it('não ressuscita valor limpo pelo usuário quando outro estágio já está configurado', () => {
    const def = sddEnxuto();
    def.stages[2].subagents = ['sdd-implementer'];
    // usuário limpou o Contexto: a UI não grava array vazio, grava ausente
    const { definition, changed } = applyFixedStageRuntime(def);
    expect(changed).toBe(false);
    expect(definition.stages[0].subagents).toBeUndefined();
  });

  it('respeita array vazio explícito como "configurado"', () => {
    const def = sddEnxuto();
    def.stages[0].skills = [];
    expect(applyFixedStageRuntime(def).changed).toBe(false);
  });

  it('ignora nome de estágio fora do mapa e não muda nada se nenhum casar', () => {
    const def: PipelineDefinition = { kind: 'fixed', stages: [{ name: 'Work' }, { name: 'Merge' }] };
    const { definition, changed } = applyFixedStageRuntime(def);
    expect(changed).toBe(false);
    expect(definition).toBe(def);
  });

  it('não muta a entrada', () => {
    const def = sddEnxuto();
    const snapshot = JSON.parse(JSON.stringify(def));
    applyFixedStageRuntime(def);
    expect(def).toEqual(snapshot);
  });

  it('aguenta definição degenerada sem lançar (a migração de boot não pode quebrar)', () => {
    expect(applyFixedStageRuntime({ stages: [] })).toEqual({ definition: { stages: [] }, changed: false });
    expect(applyFixedStageRuntime({} as PipelineDefinition).changed).toBe(false);
    expect(applyFixedStageRuntime(undefined as unknown as PipelineDefinition).changed).toBe(false);
  });
});
