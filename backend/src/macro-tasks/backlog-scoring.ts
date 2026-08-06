/**
 * Prioridade "proporcional" do backlog (melhorias.md #5) — módulo PURO.
 *
 * O pedido do usuário é que um bug pequeno suba na fila acima de uma otimização
 * grande. Isso é uma soma de três parcelas, não uma regra de desempate:
 * `score = peso(kind) + peso(effort) + priority do finding`.
 *
 * Duas escalas saem daqui de propósito:
 * - `score` (0–7) é a escala FINA, guardada em `metadata.backlog.score`, e é ela
 *   que ordena a tabela de backlog.
 * - `priority` (0–2) é o bucket que vai para a coluna Int de `MacroTask`, porque
 *   a `/macro-tasks` só sabe colorir três faixas (`priorityColors`). Gravar 0–7
 *   ali deixaria os itens mais urgentes sem cor nenhuma.
 */
import {
  DEFAULT_EFFORT,
  MAX_FINDING_PRIORITY,
  type FindingEffort,
  type FindingKind,
  type TaskReportFinding,
} from './task-report.contract';

/** Bug dói agora; docs quase nunca dói. */
export const KIND_WEIGHT: Record<FindingKind, number> = {
  bug: 3,
  debt: 2,
  improvement: 1,
  optimization: 1,
  docs: 0,
};

/** Esforço baixo pesa MAIS: é o que dá retorno rápido na fila. */
export const EFFORT_WEIGHT: Record<FindingEffort, number> = { s: 2, m: 1, l: 0 };

export const MAX_BACKLOG_SCORE =
  KIND_WEIGHT.bug + EFFORT_WEIGHT.s + MAX_FINDING_PRIORITY;

/**
 * Pipeline sugerido pelo esforço declarado. Resolvido por NOME porque o
 * `pipelineId` varia por projeto — quem resolve o id é o ingest, com fallback.
 */
export const PIPELINE_BY_EFFORT: Record<FindingEffort, string> = {
  s: 'Fix Rápido',
  m: 'Feature Simples',
  l: 'SDD Enxuto',
};

export function pipelineNameForEffort(effort: FindingEffort | undefined): string {
  return PIPELINE_BY_EFFORT[effort ?? DEFAULT_EFFORT];
}

/** Teto do bônus de repetição — 3 sessões reclamando já é o sinal completo. */
export const MAX_REPEAT_BONUS = 2;

export interface BacklogScore {
  /** Escala fina 0–7 (ou até 9 com o bônus de repetição). Ordena a tabela. */
  score: number;
  /** Bucket 0–2 gravado em `MacroTask.priority`. */
  priority: 0 | 1 | 2;
}

/**
 * Converte o score fino no bucket da coluna Int. Os cortes não são arbitrários:
 * `bug`+`s` (3+2=5) tem que cair em 2, e `optimization`+`l` (1+0=1) em 0 — é
 * literalmente o exemplo que o usuário deu.
 */
export function bucketPriority(score: number): 0 | 1 | 2 {
  if (score >= 5) return 2;
  if (score >= 3) return 1;
  return 0;
}

export function scoreFinding(finding: TaskReportFinding): BacklogScore {
  const score =
    KIND_WEIGHT[finding.kind] +
    EFFORT_WEIGHT[finding.effort] +
    Math.min(Math.max(finding.priority ?? 0, 0), MAX_FINDING_PRIORITY);
  return { score, priority: bucketPriority(score) };
}

/**
 * Recalcula o score de um item que já existia e foi visto de novo. Cada sessão
 * adicional que reporta a mesma coisa vale +1, com teto: a repetição é sinal de
 * consenso, mas não deve empurrar um item de `docs` acima de um bug real.
 */
export function scoreWithRepeats(baseScore: number, seenCount: number): BacklogScore {
  const bonus = Math.min(Math.max(seenCount - 1, 0), MAX_REPEAT_BONUS);
  const score = baseScore + bonus;
  return { score, priority: bucketPriority(score) };
}
