/**
 * MT-18: seed de `subagents`/`skills` por estágio das pipelines fixas.
 *
 * Contexto: a MT-0 criou os campos, a MT-4 criou o binding que injeta subagente
 * e skill no prompt do estágio, e a MT-3 criou os campos na UI — mas as 4
 * pipelines fixas seguiam com os dois campos AUSENTES nos 17 estágios, então o
 * binding nunca tinha nada para injetar. Este módulo é puro (sem Nest/Prisma)
 * porque `PipelinesService` o aplica numa migração de boot que não pode lançar.
 *
 * O mapa é por NOME de estágio, não por pipeline: as 4 fixas repetem os mesmos
 * nomes ("Contexto", "Implementação", "Report"…) com o mesmo papel, e assim uma
 * 5ª pipeline fixa criada depois já nasce seedada sem tocar neste arquivo.
 */
import { PipelineDefinition, PipelineStage } from './pipeline-definition';

interface StageRuntimeSeed {
  subagents?: string[];
  skills?: string[];
}

/**
 * Vocabulário real do disco (`.claude/agents`, `.claude/skills`) — nome inválido
 * aqui aparece na UI com aviso de "não encontrado", então mantenha em sincronia
 * com os arquivos do repo.
 *
 * `Merge` não entra de propósito: é estágio `mode: "engine"`, executado pelo
 * orquestrador sem CLI, e subagente/skill ali não teria quem carregasse.
 */
export const FIXED_STAGE_RUNTIME: Record<string, StageRuntimeSeed> = {
  // Levantamento antes de escrever código: o curador de RAG é read-only e a
  // skill de busca é o caminho barato para achar a região certa do arquivo-hub.
  Contexto: { subagents: ['qmd-curator'], skills: ['qmd-skill'] },
  // Único estágio em que a spec É a entrega — aqui a skill sdd tem o template.
  'Spec + Tarefas': { skills: ['sdd'] },
  Implementação: { subagents: ['sdd-implementer', 'frontend-designer'] },
  'Review + Testes': { subagents: ['sdd-reviewer'] },
  // Estágios que fecham review E report na mesma passada precisam dos dois.
  'Review + Report': { subagents: ['sdd-reviewer', 'sdd-context-curator'] },
  'Validação + Report': { subagents: ['sdd-reviewer', 'sdd-context-curator'] },
  Report: { subagents: ['sdd-context-curator'] },
};

/** `true` se ALGUM estágio já declara subagents/skills. */
function alreadySeeded(stages: PipelineStage[]): boolean {
  return stages.some((stage) => stage?.subagents !== undefined || stage?.skills !== undefined);
}

/**
 * Aplica o seed nos estágios que não declaram nada.
 *
 * Idempotente por pipeline INTEIRA, não por estágio: se qualquer estágio já
 * tiver subagents/skills, a pipeline é considerada configurada e nada é tocado.
 * É o que evita ressuscitar valor apagado de propósito — a UI grava campo vazio
 * como ausente (`...(s.subagents.length ? { subagents } : {})`), então um seed
 * por estágio voltaria a preencher no boot seguinte o que o usuário limpou.
 *
 * Não muta a entrada e devolve o mesmo objeto quando não há nada a fazer, para
 * o chamador poder pular o UPDATE no banco.
 */
export function applyFixedStageRuntime(def: PipelineDefinition): {
  definition: PipelineDefinition;
  changed: boolean;
} {
  const stages = Array.isArray(def?.stages) ? def.stages : [];
  if (stages.length === 0 || alreadySeeded(stages)) return { definition: def, changed: false };

  let changed = false;
  const nextStages = stages.map((stage) => {
    const seed = FIXED_STAGE_RUNTIME[stage?.name?.trim()];
    if (!seed) return stage;
    changed = true;
    return {
      ...stage,
      ...(seed.subagents ? { subagents: [...seed.subagents] } : {}),
      ...(seed.skills ? { skills: [...seed.skills] } : {}),
    };
  });

  return changed ? { definition: { ...def, stages: nextStages }, changed: true } : { definition: def, changed: false };
}
