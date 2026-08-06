/**
 * Report de ONDA — a mesma visão do `session-report`, agregada sobre N sessões.
 *
 * É a métrica que responde a pergunta que motivou `melhorias.md #2`: o SDD
 * Enxuto (5 stages) ficou de fato mais rápido que o fluxo antigo (8 stages)?
 * Sem isto a melhoria é fé.
 *
 * ## Por que "onda" = janela de tempo agrupada por PIPELINE
 *
 * O banco não tem nenhum campo que agrupe N sessões paralelas em uma onda: o
 * conceito só existe em `docs/melhorias/00-PLANO.md`, que o backend não lê.
 * Havia três formas de resolver e esta é a única que já funciona nos dados
 * existentes:
 *
 * - Gravar `metadata.wave` na MacroTask exigiria editar `macro-tasks/**` e
 *   `mcp-server/**` (donos: MT-7 e MT-4) e, pior, não seria retroativo — as
 *   ondas 0–3 já rodadas ficariam sem o campo, justamente as execuções que
 *   motivaram a métrica.
 * - Agrupar só por pipeline, sem janela, mistura execuções de meses diferentes
 *   e não responde "como foi ESTA onda".
 *
 * O eixo de comparação que o critério de aceite pede ("compara o tempo do SDD
 * Enxuto contra o fluxo antigo") é o pipeline, não o número da onda. Então a
 * janela responde "como foi esta onda" e o agrupamento por pipeline responde
 * "qual fluxo é mais rápido", sem uma linha de schema novo.
 *
 * Módulo puro, como o `session-report`: mediana e agregação de duração falham em
 * silêncio (um `null` tratado como 0 puxa a mediana para baixo e faz o fluxo
 * novo parecer mais rápido do que é — exatamente o erro que enganaria a decisão).
 */

import type { SessionReport, StageStatus } from './session-report';

export interface StageAggregate {
  name: string;
  /** Quantas sessões executaram este stage e deram tempo de medir. */
  samples: number;
  medianDurationMs: number | null;
  totalDurationMs: number;
  /** Somatório de tentativas além da primeira: sinal de stage problemático. */
  retries: number;
}

export interface PipelineAggregate {
  pipelineName: string;
  /** Nº de stages do pipeline — o "5 vs 8" da comparação, visível na tabela. */
  stageCount: number;
  sessions: number;
  completed: number;
  failed: number;
  live: number;
  /** Mediana da duração das sessões CONCLUÍDAS. É o número da comparação. */
  medianDurationMs: number | null;
  /** Média, para revelar quando a mediana esconde uma cauda longa. */
  avgDurationMs: number | null;
  stages: StageAggregate[];
  /** Stage que consome mais tempo somado — onde mexer rende mais. */
  slowestStage: { name: string; medianDurationMs: number | null } | null;
  questionsTotal: number;
  questionsHuman: number;
}

export interface StuckSession {
  sessionId: string;
  macroTaskTitle: string | null;
  pipelineName: string | null;
  status: string;
  /** Stage em que parou. É o "onde travaram". */
  stage: string;
  questionsOpen: number;
}

export interface WaveReport {
  from: string | null;
  to: string | null;
  sessions: number;
  completed: number;
  failed: number;
  live: number;
  /** Mediana geral das concluídas, ignorando o pipeline. */
  medianDurationMs: number | null;
  /** Uma linha por pipeline, ordenada da mediana menor para a maior. */
  pipelines: PipelineAggregate[];
  /** Sessões que não completaram, com o stage onde pararam. */
  stuck: StuckSession[];
  questionsTotal: number;
  questionsOpen: number;
  questionsHuman: number;
}

const LIVE_STATUSES = ['initializing', 'running', 'waiting', 'paused'];

/**
 * Mediana de uma amostra. `null` para amostra vazia — 0 seria uma sessão
 * instantânea, e a comparação entre pipelines premiaria o que não tem dado.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Só sessão concluída entra na comparação de duração. */
function completedDurations(reports: SessionReport[]): number[] {
  return reports
    .filter((report) => report.status === 'completed' && report.durationMs !== null)
    .map((report) => report.durationMs as number);
}

/**
 * Agrega os stages de um grupo de sessões. Stage herdado por resume entra com
 * `durationMs: null` no report de sessão e por isso não conta como amostra: o
 * tempo dele foi gasto na sessão anterior e contá-lo duas vezes inflaria o
 * total do pipeline.
 */
function aggregateStages(reports: SessionReport[]): StageAggregate[] {
  const byName = new Map<string, { durations: number[]; retries: number }>();
  // A ordem de inserção segue a ordem dos stages no report, que é a do
  // pipeline: preserva a leitura "fase 1 → fase 5" na tabela.
  for (const report of reports) {
    for (const stage of report.stages) {
      const entry = byName.get(stage.name) ?? { durations: [], retries: 0 };
      if (stage.durationMs !== null) entry.durations.push(stage.durationMs);
      if (stage.attempts > 1) entry.retries += stage.attempts - 1;
      byName.set(stage.name, entry);
    }
  }
  return [...byName.entries()].map(([name, entry]) => ({
    name,
    samples: entry.durations.length,
    medianDurationMs: median(entry.durations),
    totalDurationMs: entry.durations.reduce((sum, value) => sum + value, 0),
    retries: entry.retries,
  }));
}

function countStatus(reports: SessionReport[], status: StageStatus | string): number {
  return reports.filter((report) => report.status === status).length;
}

function sumCount(reports: SessionReport[], key: keyof SessionReport['counts']): number {
  return reports.reduce((sum, report) => sum + report.counts[key], 0);
}

/**
 * Monta o report agregado. `from`/`to` são só o rótulo da janela usada na
 * consulta — este módulo não filtra nada, quem filtra é o service.
 */
export function buildWaveReport(
  reports: SessionReport[],
  window: { from?: string | null; to?: string | null } = {},
): WaveReport {
  const byPipeline = new Map<string, SessionReport[]>();
  for (const report of reports) {
    // Sessão cujo pipeline foi apagado ainda precisa aparecer em algum grupo,
    // senão desaparece do total e a soma das linhas não fecha com o cabeçalho.
    const key = report.pipelineName ?? '(sem pipeline)';
    byPipeline.set(key, [...(byPipeline.get(key) ?? []), report]);
  }

  const pipelines: PipelineAggregate[] = [...byPipeline.entries()]
    .map(([pipelineName, group]) => {
      const durations = completedDurations(group);
      const stages = aggregateStages(group);
      const slowest = stages.reduce<StageAggregate | null>(
        (worst, stage) =>
          !worst || stage.totalDurationMs > worst.totalDurationMs ? stage : worst,
        null,
      );
      return {
        pipelineName,
        // Do report de sessão, não do pipeline vivo: se alguém editou o
        // pipeline depois, o que vale é o que a sessão de fato executou.
        stageCount: Math.max(...group.map((report) => report.stages.length), 0),
        sessions: group.length,
        completed: countStatus(group, 'completed'),
        failed: group.filter(
          (report) => !LIVE_STATUSES.includes(report.status) && report.status !== 'completed',
        ).length,
        live: group.filter((report) => LIVE_STATUSES.includes(report.status)).length,
        medianDurationMs: median(durations),
        avgDurationMs: average(durations),
        stages,
        slowestStage: slowest
          ? { name: slowest.name, medianDurationMs: slowest.medianDurationMs }
          : null,
        questionsTotal: sumCount(group, 'questionsOpen') + sumCount(group, 'questionsAnswered'),
        questionsHuman: sumCount(group, 'questionsHuman'),
      };
    })
    // Pipeline sem sessão concluída (mediana `null`) vai para o fim: não tem
    // número para comparar e ficaria fingindo ser o mais rápido no topo.
    .sort((a, b) => {
      if (a.medianDurationMs === null) return b.medianDurationMs === null ? 0 : 1;
      if (b.medianDurationMs === null) return -1;
      return a.medianDurationMs - b.medianDurationMs;
    });

  const stuck: StuckSession[] = reports
    .filter((report) => report.status !== 'completed')
    .map((report) => ({
      sessionId: report.sessionId,
      macroTaskTitle: report.macroTaskTitle,
      pipelineName: report.pipelineName,
      status: report.status,
      stage: report.currentStage,
      questionsOpen: report.counts.questionsOpen,
    }));

  return {
    from: window.from ?? null,
    to: window.to ?? null,
    sessions: reports.length,
    completed: countStatus(reports, 'completed'),
    failed: reports.filter(
      (report) => !LIVE_STATUSES.includes(report.status) && report.status !== 'completed',
    ).length,
    live: reports.filter((report) => LIVE_STATUSES.includes(report.status)).length,
    medianDurationMs: median(completedDurations(reports)),
    pipelines,
    stuck,
    questionsTotal: sumCount(reports, 'questionsOpen') + sumCount(reports, 'questionsAnswered'),
    questionsOpen: sumCount(reports, 'questionsOpen'),
    questionsHuman: sumCount(reports, 'questionsHuman'),
  };
}
