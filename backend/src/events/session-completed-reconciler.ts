/**
 * Lógica pura da reconciliação de `session:completed` (MT-20, item 6). O
 * pub/sub do Redis é fire-and-forget: um evento publicado com o backend fora do
 * ar é perdido por todos os subscribers, sem retry nem replay — na noite de
 * 03/08/2026 o backend ficou ~20 min fora do ar e todos os eventos do período
 * sumiram (ver `decisoes/mt-11.md`). Com o `BacklogIngestService` consumindo
 * `SESSION_COMPLETED` para materializar backlog, evento perdido = backlog que
 * nunca é criado, em silêncio.
 *
 * Corrigido com uma marca d'água (`SESSION_COMPLETED_WATERMARK_KEY`): o
 * `completedAt` da última sessão já vista. Não é um replay cego do canal —
 * republicar o evento também dispararia o `qmd-embed` e o `session-governor`,
 * que não precisam de reconciliação (o `qmd-embed` reagenda sozinho, e o
 * `session-governor` já tem o poll de 30s como fallback). A reconciliação varre
 * `Session.completedAt` direto e chama `BacklogIngestService.ingestSession`
 * (idempotente), sem tocar nos outros assinantes.
 */

export interface ReconcilableSession {
  id: string;
  completedAt: Date;
}

/**
 * Sessões concluídas que a marca d'água ainda não viu, mais antiga primeiro
 * (mesma ordem de conclusão real).
 *
 * Comparação estritamente MAIOR (`>`): a sessão exatamente NA marca já foi
 * processada da vez anterior — é dela que a marca veio. Um `>=` reprocessaria
 * essa mesma sessão a cada boot, para sempre.
 */
export function sessionsSinceWatermark(
  sessions: ReconcilableSession[],
  watermarkIso: string | null,
): ReconcilableSession[] {
  const watermark = watermarkIso ? new Date(watermarkIso).getTime() : null;
  return sessions
    .filter((session) => watermark === null || session.completedAt.getTime() > watermark)
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
}

/**
 * Marca d'água seguinte: o `completedAt` mais recente entre as sessões vistas
 * agora, nunca regredindo. Sem o `Math.max` contra a marca atual, um evento
 * reentregue fora de ordem (SCAN + pub/sub cruzando no boot) poderia empurrar a
 * marca para trás e reabrir sessões já reconciliadas.
 */
export function advanceWatermark(
  currentIso: string | null,
  seen: ReconcilableSession[],
): string | null {
  if (seen.length === 0) return currentIso;
  const latest = seen.reduce(
    (max, session) => (session.completedAt.getTime() > max.getTime() ? session.completedAt : max),
    seen[0].completedAt,
  );
  if (currentIso && new Date(currentIso).getTime() >= latest.getTime()) return currentIso;
  return latest.toISOString();
}
