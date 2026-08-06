import type { PrismaClient } from '@prisma/client';
import {
  computeTickIntervalMinutes,
  SchedulingConfig,
} from '../master-agent/master-scheduling.config';

/**
 * Contrato do `ScheduledJob` de tipo `master_tick` — o tick periódico do Master
 * de UM projeto.
 *
 * MT-20, item 2: existia um agendador em memória (`setInterval` no
 * `MasterAgentService`) e outro em banco (`ScheduledJob`, do `/scheduler`). O
 * dono passou a ser UM: o `ScheduledJob`. `Project.settings.automation` continua
 * sendo a CONFIG (é o que a UI edita), e é essa config que materializa aqui um
 * job por projeto — o job é a projeção dela, não uma segunda verdade.
 *
 * Por que o job e não o timer:
 * - o cron de 30 s do `SchedulerService` não depende de projeto ativo, então N
 *   projetos disparam sem N timers e sem "projeto ativo do Master";
 * - `scheduledAt` no banco sobrevive ao restart e é legível por qualquer um —
 *   daí o "próximo disparo" da UI funcionar com o Master desligado.
 *
 * Como o `master_loop`, nada disso precisa de coluna nova: `type` é string livre
 * e `payload` é `Json`.
 *
 * ```jsonc
 * {
 *   "type": "master_tick",
 *   "scheduledAt": "2026-08-04T12:10:00.000Z",
 *   "status": "pending",
 *   "payload": {
 *     "projectId": "uuid-do-projeto",
 *     "runCount": 12,
 *     "lastRunAt": "2026-08-04T12:00:03.000Z",
 *     "lastError": "Master Agent terminal is not running"  // partes de CLI não rodaram
 *   }
 * }
 * ```
 */
export const MASTER_TICK_JOB_TYPE = 'master_tick';

export interface MasterTickPayload {
  projectId: string;
  /** Ticks já disparados. Só informativo — o tick não tem teto de execuções. */
  runCount: number;
  lastRunAt?: string;
  /** Motivo de o último tick ter rodado parcialmente (sem terminal, por exemplo). */
  lastError?: string;
}

/** Leitura tolerante do payload persistido: `Json` do banco não tem garantia de tipo. */
export function readMasterTickPayload(raw: unknown): MasterTickPayload {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const runCount = Number(source.runCount);
  return {
    projectId: typeof source.projectId === 'string' ? source.projectId : '',
    runCount: Number.isInteger(runCount) && runCount > 0 ? runCount : 0,
    lastRunAt: typeof source.lastRunAt === 'string' ? source.lastRunAt : undefined,
    lastError: typeof source.lastError === 'string' ? source.lastError : undefined,
  };
}

/** Prisma mínimo usado aqui — mantém a função testável sem subir o Nest. */
type ScheduledJobDelegate = Pick<
  PrismaClient['scheduledJob'],
  'findMany' | 'create' | 'update' | 'delete'
>;

/**
 * Job de tick do projeto entre os pendentes/em execução. O filtro é em código, e
 * não um `where` sobre o `Json`: `payload` é livre e um job gravado à mão (ou por
 * uma versão anterior) pode não ter `projectId` — filtrar no banco esconderia
 * essas linhas, e é justamente nelas que se percebe o job órfão.
 */
async function findProjectTickJobs(jobs: ScheduledJobDelegate, projectId: string) {
  const pending = await jobs.findMany({
    where: { type: MASTER_TICK_JOB_TYPE, status: { in: ['pending', 'running'] } },
    orderBy: { scheduledAt: 'asc' },
  });
  return pending.filter((job) => readMasterTickPayload(job.payload).projectId === projectId);
}

export interface MasterTickSyncResult {
  /** ISO do próximo disparo, ou `null` quando não há nenhuma parte habilitada. */
  scheduledAt: string | null;
  action: 'created' | 'rescheduled' | 'kept' | 'removed' | 'none';
}

/**
 * Reconcilia o job `master_tick` do projeto com a config de automação: cria,
 * reagenda ou remove. É idempotente de propósito — roda no boot, no `activate` e
 * em todo save de automação, e um save que não mudou a cadência não pode
 * empurrar o próximo disparo para frente (era o bug de "salvar reinicia o
 * relógio" que a MT-2 já tinha corrigido para o timer).
 *
 * `now` é injetável porque `syncMasterTickJob` é chamado em teste.
 */
export async function syncMasterTickJob(
  jobs: ScheduledJobDelegate,
  projectId: string,
  config: SchedulingConfig,
  now: Date = new Date(),
): Promise<MasterTickSyncResult> {
  const tickMinutes = computeTickIntervalMinutes(config);
  const own = await findProjectTickJobs(jobs, projectId);
  const [mine, ...duplicates] = own;

  // Duplicata só aparece se dois saves correrem juntos; some no primeiro sync.
  for (const extra of duplicates) {
    if (extra.status === 'pending') await jobs.delete({ where: { id: extra.id } });
  }

  if (tickMinutes === null) {
    // Nada habilitado: o job sai de cena em vez de ficar pendente para sempre.
    // Só os pendentes — um `running` está sendo executado agora pelo scheduler.
    let removed = 0;
    for (const job of own) {
      if (job.status !== 'pending') continue;
      await jobs.delete({ where: { id: job.id } });
      removed++;
    }
    return { scheduledAt: null, action: removed > 0 ? 'removed' : 'none' };
  }

  const nextAt = new Date(now.getTime() + tickMinutes * 60_000);

  if (!mine) {
    const created = await jobs.create({
      data: {
        type: MASTER_TICK_JOB_TYPE,
        payload: { projectId, runCount: 0 },
        scheduledAt: nextAt,
        notes: `Tick automático do Master (a cada ${tickMinutes} min) — editado em /master-agent`,
      },
    });
    return { scheduledAt: created.scheduledAt.toISOString(), action: 'created' };
  }

  // Já dentro da nova cadência: não mexe. Encurtar o intervalo, porém, tem que
  // antecipar — senão o usuário troca 60 min por 5 e espera a hora inteira.
  const currentAt = mine.scheduledAt.getTime();
  if (currentAt > now.getTime() && currentAt <= nextAt.getTime()) {
    return { scheduledAt: mine.scheduledAt.toISOString(), action: 'kept' };
  }

  const updated = await jobs.update({
    where: { id: mine.id },
    data: { scheduledAt: nextAt, status: 'pending' },
  });
  return { scheduledAt: updated.scheduledAt.toISOString(), action: 'rescheduled' };
}

/**
 * Próximo disparo do projeto lido do banco (não de timer em memória): é o que a
 * UI mostra, com o Master ligado ou não, em qualquer projeto.
 */
export async function readNextTickAt(
  jobs: ScheduledJobDelegate,
  projectId: string,
): Promise<string | null> {
  const [mine] = await findProjectTickJobs(jobs, projectId);
  return mine ? mine.scheduledAt.toISOString() : null;
}
