import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { MASTER_SCHEDULING_KEY, masterSchedulingCacheKey } from '../redis/keys';

/**
 * Config de automações do Master (sweep de triagem, health-check de sessões,
 * status report) — extraída de `master-agent.service.ts` (MT-2) para reduzir o
 * bloco de scheduling ali a chamadas deste módulo.
 *
 * Persistência: `Project.settings.automation` (Json, sem migration) é a
 * verdade; o Redis vira cache quente por projeto (`masterSchedulingCacheKey`).
 * Um projeto sem `settings.automation` ainda gravado herda, uma vez só, o
 * valor legado e GLOBAL de `MASTER_SCHEDULING_KEY` (pré-MT-2, quando só havia
 * uma config para o backend inteiro) — depois disso a chave por-projeto passa
 * a existir e a migração não roda de novo.
 */

const logger = new Logger('MasterSchedulingConfig');

/** Chave dentro de `project.settings`. */
export const AUTOMATION_SETTINGS_KEY = 'automation';

export interface SchedulingConfig {
  /**
   * MT-28: UM intervalo para as três partes do tick. Antes eram três
   * (`sweepIntervalMinutes`, `sessionCheckIntervalMinutes`,
   * `statusReportIntervalMinutes`) e o timer rodava no menor deles, o que dava
   * um timer com três agendas — cada parte esperando o vencimento dela e, na
   * prática, arredondada pra cima no múltiplo do tick. Agora o tick roda e
   * TODA parte habilitada roda nele.
   */
  tickIntervalMinutes: number;
  autoTriageEnabled: boolean;
  repromptAfterMs: number;
  /** Health-check periódico das sessões pelo Master (via terminal + MCP tools). */
  sessionCheckEnabled: boolean;
  /** Sessão running/waiting sem update há mais que isso é considerada travada. */
  stalledAfterMinutes: number;
  /** Relatório de status periódico postado no chat do dashboard (via reply_chat). */
  statusReportEnabled: boolean;
  /**
   * Auto-start da próxima macro task pendente (MT-27). Opt-in por projeto: com
   * `false` (default) o comportamento é o de antes — só sobe task que alguém
   * mandou subir. Task individual sai do auto-start com
   * `MacroTask.metadata.autoStart === false`.
   */
  autoStartEnabled: boolean;
  /** Teto de tasks promovidas por tick — sem ele, 13 pendentes subiriam de uma vez. */
  autoStartMaxPerTick: number;
  /** Reciclagem periódica do terminal do Master (MT-27): contexto do CLI não cresce pra sempre. */
  contextRecycleEnabled: boolean;
  contextRecycleAfterTicks: number;
}

const REPROMPT_AFTER_MS = 10 * 60 * 1000;
// 10 min era o intervalo default do sweep e, com o status report nascendo
// desligado, já era a cadência efetiva do timer (`min(sweep 10, check 15)`).
const DEFAULT_TICK_INTERVAL_MINUTES = 10;
const DEFAULT_STALLED_AFTER_MINUTES = 10;
const DEFAULT_AUTO_START_MAX_PER_TICK = 1;
const DEFAULT_CONTEXT_RECYCLE_AFTER_TICKS = 20;

export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  tickIntervalMinutes: DEFAULT_TICK_INTERVAL_MINUTES,
  autoTriageEnabled: true,
  repromptAfterMs: REPROMPT_AFTER_MS,
  sessionCheckEnabled: true,
  stalledAfterMinutes: DEFAULT_STALLED_AFTER_MINUTES,
  statusReportEnabled: false,
  // MT-27: os dois nascem desligados de propósito — automação que sobe sessão
  // sozinha ou mata o terminal do Master não pode aparecer num projeto que
  // atualizou o backend sem pedir nada disso.
  autoStartEnabled: false,
  autoStartMaxPerTick: DEFAULT_AUTO_START_MAX_PER_TICK,
  contextRecycleEnabled: false,
  contextRecycleAfterTicks: DEFAULT_CONTEXT_RECYCLE_AFTER_TICKS,
};

const NUMBER_FIELDS = [
  'tickIntervalMinutes',
  'repromptAfterMs',
  'stalledAfterMinutes',
  'autoStartMaxPerTick',
  'contextRecycleAfterTicks',
] as const;
const BOOL_FIELDS = [
  'autoTriageEnabled',
  'sessionCheckEnabled',
  'statusReportEnabled',
  'autoStartEnabled',
  'contextRecycleEnabled',
] as const;

/** Mesmos mínimos que o serviço já aplicava campo a campo antes do MT-2. */
const MIN_VALUES: Record<(typeof NUMBER_FIELDS)[number], number> = {
  // MT-28: 1, e não o 5 que o `statusReportIntervalMinutes` exigia. Herdar o
  // mais restritivo dos três clamparia PRA CIMA config já gravada com sweep de
  // 1 ou 2 min — deixar a leitura mudar a cadência de quem não pediu nada é
  // exatamente o efeito silencioso que esta linha de tasks existe para apagar.
  // O custo de um tick curto (um turno do Master por ciclo, e o report no chat
  // nessa cadência) é avisado na UI, onde há um humano para decidir.
  tickIntervalMinutes: 1,
  repromptAfterMs: 60_000,
  stalledAfterMinutes: 1,
  autoStartMaxPerTick: 1,
  // Reciclar a cada tick jogaria fora o contexto antes de ele servir pra
  // alguma coisa — 2 é o menor valor em que a reciclagem ainda é reciclagem.
  contextRecycleAfterTicks: 2,
};

function cleanNumber(value: unknown, min: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(min, value);
}

/**
 * Os três intervalos por parte que existiam até a MT-27. Sobrevivem apenas como
 * ENTRADA legada: a leitura os colapsa em `tickIntervalMinutes` e o PATCH os
 * ignora. Nada os escreve de volta.
 */
export const LEGACY_INTERVAL_FIELDS = [
  'sweepIntervalMinutes',
  'sessionCheckIntervalMinutes',
  'statusReportIntervalMinutes',
] as const;

/** Qual flag habilitava cada intervalo legado (o sweep também servia o auto-start). */
const LEGACY_INTERVAL_ENABLERS: Record<
  (typeof LEGACY_INTERVAL_FIELDS)[number],
  (config: SchedulingConfig) => boolean
> = {
  sweepIntervalMinutes: (config) => config.autoTriageEnabled || config.autoStartEnabled,
  sessionCheckIntervalMinutes: (config) => config.sessionCheckEnabled,
  statusReportIntervalMinutes: (config) => config.statusReportEnabled,
};

/**
 * Cadência derivada de uma config gravada antes da MT-28: o MENOR intervalo
 * entre as partes habilitadas — que é exatamente o que a MT-27 já usava como
 * cadência do único timer. Assim quem só atualizou o backend não vê o Master
 * ficar mais lento nem mais rápido do que estava (OneQuest: sweep 30, check 40,
 * report 20 ⇒ 20).
 *
 * Sem nenhuma parte habilitada cai no menor intervalo presente (a config ainda
 * diz algo sobre a intenção de quem gravou); sem nenhum campo legado devolve
 * `undefined`, e o default vale.
 */
function deriveLegacyTickInterval(
  source: Record<string, unknown>,
  flags: SchedulingConfig,
): number | undefined {
  const enabled: number[] = [];
  const present: number[] = [];
  for (const field of LEGACY_INTERVAL_FIELDS) {
    const value = cleanNumber(source[field], MIN_VALUES.tickIntervalMinutes);
    if (value === undefined) continue;
    present.push(value);
    if (LEGACY_INTERVAL_ENABLERS[field](flags)) enabled.push(value);
  }
  const candidates = enabled.length > 0 ? enabled : present;
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

/**
 * Leitura permissiva: nunca lança. Campo ausente ou podre cai no default;
 * campo numérico válido é clampado no mínimo permitido. É o caminho usado ao
 * ler `Json` do banco/Redis, que não tem garantia de tipo.
 */
export function normalizeSchedulingConfig(raw: unknown): SchedulingConfig {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const out = { ...DEFAULT_SCHEDULING_CONFIG };
  // Booleanos primeiro: a derivação do intervalo legado logo abaixo precisa
  // saber quais partes estavam habilitadas na config lida.
  for (const field of BOOL_FIELDS) {
    if (typeof source[field] === 'boolean') out[field] = source[field] as boolean;
  }
  for (const field of NUMBER_FIELDS) {
    const value = cleanNumber(source[field], MIN_VALUES[field]);
    if (value !== undefined) out[field] = value;
  }
  if (cleanNumber(source.tickIntervalMinutes, MIN_VALUES.tickIntervalMinutes) === undefined) {
    const legacy = deriveLegacyTickInterval(source, out);
    if (legacy !== undefined) out.tickIntervalMinutes = legacy;
  }
  return out;
}

/**
 * Validação de ESCRITA: patch com campo desconhecido ou tipo errado lança —
 * aqui há um humano na ponta (o PATCH da UI) para corrigir, diferente da
 * leitura acima.
 *
 * Exceção: os três intervalos legados passam ignorados, com `warn`. Uma aba
 * aberta antes do deploy da MT-28 ainda manda o rascunho INTEIRO num PATCH só;
 * lançar ali transformaria uma aba velha em erro 500 no save, e o campo que ela
 * mandaria não existe mais para ser aplicado.
 */
export function assertValidSchedulingPatch(patch: unknown): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Scheduling patch must be a plain object');
  }
  const source = patch as Record<string, unknown>;
  const known = new Set<string>([...NUMBER_FIELDS, ...BOOL_FIELDS]);
  const legacy = new Set<string>(LEGACY_INTERVAL_FIELDS);
  for (const [key, value] of Object.entries(source)) {
    if (legacy.has(key)) {
      logger.warn(`Ignoring legacy scheduling field "${key}" — replaced by tickIntervalMinutes (MT-28)`);
      continue;
    }
    if (!known.has(key)) {
      throw new Error(`Unknown scheduling field: "${key}" (allowed: ${[...known].join(', ')})`);
    }
    if ((NUMBER_FIELDS as readonly string[]).includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`"${key}" must be a finite number`);
      }
    } else if (typeof value !== 'boolean') {
      throw new Error(`"${key}" must be a boolean`);
    }
  }
}

/** Aplica um patch já validado, clampando cada campo numérico no mínimo permitido. */
export function applySchedulingPatch(
  current: SchedulingConfig,
  patch: Partial<SchedulingConfig>,
): SchedulingConfig {
  const next = { ...current };
  for (const field of NUMBER_FIELDS) {
    const value = patch[field];
    if (value !== undefined) next[field] = Math.max(MIN_VALUES[field], value);
  }
  for (const field of BOOL_FIELDS) {
    const value = patch[field];
    if (value !== undefined) next[field] = value;
  }
  return next;
}

/** Base do save idempotente: compara campo a campo, não referência. */
export function schedulingConfigsEqual(a: SchedulingConfig, b: SchedulingConfig): boolean {
  return [...NUMBER_FIELDS, ...BOOL_FIELDS].every((field) => a[field] === b[field]);
}

/**
 * Cadência do ÚNICO timer do Master. MT-28: é o `tickIntervalMinutes`, sem
 * `Math.min` de nada — toda parte habilitada roda em todo tick, e as partes do
 * mesmo tick viram UM prompt só (que é o ponto desde a MT-27: antes eram três
 * turnos separados no mesmo terminal, cada um recarregando o estado que o
 * outro acabou de ler).
 *
 * `contextRecycleEnabled` não conta como parte: reciclar contexto sem nenhuma
 * automação para gastar contexto não tem o que reciclar. `null` = nada
 * habilitado, não arma timer.
 */
export function computeTickIntervalMinutes(config: SchedulingConfig): number | null {
  const anyPartEnabled =
    config.autoTriageEnabled ||
    config.autoStartEnabled ||
    config.sessionCheckEnabled ||
    config.statusReportEnabled;
  return anyPartEnabled ? config.tickIntervalMinutes : null;
}

/**
 * Próximo tick a partir do instante em que o timer foi (re)armado (`armedAt`,
 * epoch ms). `null` = nenhuma parte habilitada, nada a prometer. É o que o save
 * devolve pro usuário ver que pegou.
 *
 * MT-28: um horário só, e sem arredondamento. Antes eram três (um por parte),
 * cada um arredondado pra cima no múltiplo do tick porque a parte esperava o
 * vencimento do intervalo DELA — o que a UI mostrava como "next sweep 14:40"
 * quando o intervalo dizia 30 min.
 */
export function computeNextTickAt(config: SchedulingConfig, armedAt: number): string | null {
  const tick = computeTickIntervalMinutes(config);
  if (tick === null) return null;
  return new Date(armedAt + tick * 60_000).toISOString();
}

// ------------------------------------------------------------ persistência

/**
 * Lê `Project.settings.automation` (cache Redis por-projeto primeiro). Sem
 * nada gravado ainda, tenta herdar o legado global do Redis (pré-MT-2) e já
 * persiste no banco — a migração roda uma vez só, na primeira leitura.
 */
export async function loadSchedulingConfig(
  prisma: PrismaService,
  redis: RedisService,
  projectId: string,
): Promise<SchedulingConfig> {
  try {
    const cached = await redis.getClient().get(masterSchedulingCacheKey(projectId));
    if (cached) return normalizeSchedulingConfig(JSON.parse(cached));
  } catch (error) {
    logger.warn(`Failed to read cached scheduling config for project ${projectId}: ${error.message}`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { settings: true },
  });
  if (!project) {
    // Projeto sumiu (deletado, id inválido vindo de um `currentProject` do
    // frontend desatualizado): default sem persistir — `persistSchedulingConfig`
    // faria um `update` numa linha que não existe e lançaria em vez de só
    // devolver a config. Isto é leitura; não crie o projeto de volta.
    logger.warn(`Scheduling config requested for unknown project ${projectId} — using defaults`);
    return { ...DEFAULT_SCHEDULING_CONFIG };
  }
  const settings = (project.settings as Record<string, unknown> | null) ?? {};
  const stored = settings[AUTOMATION_SETTINGS_KEY];
  if (stored !== undefined) {
    const config = normalizeSchedulingConfig(stored);
    await mirrorToCache(redis, projectId, config);
    return config;
  }

  let migrated: SchedulingConfig | null = null;
  try {
    const legacy = await redis.getClient().get(MASTER_SCHEDULING_KEY);
    if (legacy) migrated = normalizeSchedulingConfig(JSON.parse(legacy));
  } catch (error) {
    logger.warn(`Failed to read legacy global scheduling config from Redis: ${error.message}`);
  }
  const config = migrated ?? { ...DEFAULT_SCHEDULING_CONFIG };
  await persistSchedulingConfig(prisma, redis, projectId, config);
  return config;
}

/** Grava em `Project.settings.automation` (verdade) e atualiza o cache Redis do projeto. */
export async function persistSchedulingConfig(
  prisma: PrismaService,
  redis: RedisService,
  projectId: string,
  config: SchedulingConfig,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { settings: true },
  });
  if (!project) {
    // Erro claro em vez do P2025 cru do Prisma vazando pro controller —
    // aqui é escrita explícita (PATCH), então falhar é o certo, só que legível.
    throw new Error(`Project not found: ${projectId}`);
  }
  const settings = (project.settings as Record<string, unknown> | null) ?? {};
  await prisma.project.update({
    where: { id: projectId },
    data: {
      settings: { ...settings, [AUTOMATION_SETTINGS_KEY]: config } as unknown as Prisma.InputJsonValue,
    },
  });
  await mirrorToCache(redis, projectId, config);
}

async function mirrorToCache(
  redis: RedisService,
  projectId: string,
  config: SchedulingConfig,
): Promise<void> {
  await redis
    .getClient()
    .set(masterSchedulingCacheKey(projectId), JSON.stringify(config))
    .catch((error) =>
      logger.warn(`Failed to mirror scheduling config for project ${projectId}: ${error.message}`),
    );
}
