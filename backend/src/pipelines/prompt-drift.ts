import { PipelineDefinition } from './pipeline-definition';

/**
 * Referências que promptTemplate NÃO pode mais citar — caminhos aposentados
 * pelo próprio código/convenção, mas que sobrevivem em texto gravado no banco
 * porque `grep` no repo não alcança `Json` de coluna (MT-26). Cada entrada é
 * um trecho literal; usar string em vez de regex mantém a lista legível e
 * fácil de estender quando o próximo caminho for aposentado.
 *
 * Casamento é por substring simples — NÃO distingue "usa o caminho velho" de
 * "cita o caminho velho para avisar que não deve mais ser usado". Isso já
 * mordeu esta própria correção: a primeira redação do texto corrigido dizia
 * "NÃO em `03-DECISOES.md`", e o próprio detector acusou o fix como drift.
 * A correção foi reescrever o texto para nunca repetir o caminho aposentado
 * (nem como exemplo do que evitar) — não adicionar heurística de exceção
 * aqui. Ao escrever prompt corretivo, siga a mesma regra.
 */
const STALE_REFERENCES: Array<{ needle: string; reason: string }> = [
  { needle: '03-DECISOES.md', reason: 'convenção atual é docs/melhorias/decisoes/<mt-id>.md (02-CONVENCOES.md)' },
  { needle: '04-prompts', reason: 'layout SDD antigo (9 diretórios) — o atual tem 3' },
  { needle: '05-tasks', reason: 'layout SDD antigo (9 diretórios) — o atual tem 3' },
  { needle: '06-validation', reason: 'layout SDD antigo (9 diretórios) — o atual tem 3' },
  { needle: '02-discovery', reason: 'layout SDD antigo (9 diretórios) — o atual tem 3' },
  { needle: '08-handoffs', reason: 'layout SDD antigo (9 diretórios) — o atual tem 3' },
];

export interface PromptDriftMatch {
  stage: string;
  needle: string;
  reason: string;
}

/**
 * Varre os `promptTemplate` de todos os stages atrás de referência aposentada.
 * Pura (sem I/O): recebe a `PipelineDefinition` já normalizada, devolve os
 * achados. Vazio = sem drift. Usada tanto no teste quanto no aviso de
 * `PipelinesService.create/update` (write-time, não bloqueia — é lint, não
 * validação de contrato).
 */
export function detectPromptDrift(pipeline: PipelineDefinition): PromptDriftMatch[] {
  const matches: PromptDriftMatch[] = [];
  for (const stage of pipeline.stages ?? []) {
    const text = stage.promptTemplate;
    if (typeof text !== 'string' || !text) continue;
    for (const { needle, reason } of STALE_REFERENCES) {
      if (text.includes(needle)) matches.push({ stage: stage.name, needle, reason });
    }
  }
  return matches;
}
