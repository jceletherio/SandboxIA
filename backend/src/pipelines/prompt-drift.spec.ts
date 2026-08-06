/**
 * MT-26: `promptTemplate` gravado no banco não passa por `grep` no repo — é
 * exatamente por isso que os 3 pipelines ficaram anos apontando para
 * `03-DECISOES.md` sem ninguém notar. `detectPromptDrift` é a verificação que
 * teria pego isso; este teste prova com o texto REAL que estava gravado (antes
 * da correção desta task) e com o texto corrigido.
 */
import { detectPromptDrift } from './prompt-drift';
import { PipelineDefinition } from './pipeline-definition';

const withImplPrompt = (promptTemplate: string): PipelineDefinition => ({
  stages: [{ name: 'Implementação', promptTemplate }],
});

describe('detectPromptDrift', () => {
  it('acha a referência antiga (regressão — texto real gravado no banco antes da correção)', () => {
    const drifted = withImplPrompt(
      'Decisão não óbvia → `docs/melhorias/03-DECISOES.md` (append, 1 parágrafo).',
    );
    const matches = detectPromptDrift(drifted);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ stage: 'Implementação', needle: '03-DECISOES.md' });
  });

  it('não acusa o caminho novo (docs/melhorias/decisoes/<mt-id>.md)', () => {
    const fixed = withImplPrompt(
      'Decisão não óbvia → `docs/melhorias/decisoes/mt-26.md` (append, 1 parágrafo).',
    );
    expect(detectPromptDrift(fixed)).toEqual([]);
  });

  it('casamento é por substring simples — citar o caminho velho para avisar contra ele também acusa', () => {
    // Documenta um limite real, não hipotético: a primeira redação do fix
    // desta task dizia "NÃO em `03-DECISOES.md`" e o detector acusou o
    // próprio fix como drift. A correção foi reescrever o texto para nunca
    // repetir o caminho aposentado — não ensinar o detector a distinguir
    // aviso de uso real, o que exigiria heurística frágil para um ganho
    // pequeno. Prompt corretivo deve seguir essa regra.
    const caution = withImplPrompt('Não use mais `03-DECISOES.md` — está aposentado.');
    expect(detectPromptDrift(caution)).toHaveLength(1);
  });

  it('acusa referência a diretório do layout SDD antigo (mesma classe do item 2)', () => {
    const drifted = withImplPrompt('Grave o relatório em `06-validation/{NNN}-{slug}/review-report.json`.');
    const matches = detectPromptDrift(drifted);
    expect(matches).toHaveLength(1);
    expect(matches[0].needle).toBe('06-validation');
  });

  it('stage sem promptTemplate não quebra e não acusa nada', () => {
    expect(detectPromptDrift({ stages: [{ name: 'Merge' }] })).toEqual([]);
  });

  it('varre TODOS os stages, não só o primeiro', () => {
    const pipeline: PipelineDefinition = {
      stages: [
        { name: 'Contexto', promptTemplate: 'sem drift aqui' },
        { name: 'Implementação', promptTemplate: 'escreva em `03-DECISOES.md`' },
      ],
    };
    const matches = detectPromptDrift(pipeline);
    expect(matches).toHaveLength(1);
    expect(matches[0].stage).toBe('Implementação');
  });
});
