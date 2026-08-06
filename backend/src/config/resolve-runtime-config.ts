/**
 * Resolver de configuração de runtime de uma sessão (MT-0, contratos §3).
 *
 * Módulo PURO: sem Nest, sem Prisma, sem I/O. É consumido pelo pipeline-engine,
 * pelo session-runtime e pelas MCP tools do Master — todos passam as camadas já
 * lidas do banco/env e recebem de volta a config final mais a proveniência.
 *
 * Precedência, do mais fraco para o mais forte:
 *
 *   env  <  project.settings.defaults  <  pipeline.defaults  <  stage  <  sessionOverride
 *
 * Escalares (`model`, `cliProfile`, `permissionMode`, `timeout`): o mais forte
 * ganha. Listas (`subagents`, `skills`): UNIÃO deduplicada, ordem preservada —
 * uma skill posta no projeto não é apagada por um estágio que declara outra.
 */

/** Nome de cada camada, do mais fraco para o mais forte. Vai para o `provenance`. */
export const CONFIG_LAYERS = [
  'env',
  'projectDefaults',
  'pipelineDefaults',
  'stage',
  'sessionOverride',
] as const;

export type ConfigLayer = (typeof CONFIG_LAYERS)[number];

export interface ResolvedConfig {
  model?: string;
  cliProfile?: string;
  permissionMode?: string;
  /** União deduplicada de todas as camadas, ordem preservada (fraco → forte). */
  subagents: string[];
  /** União deduplicada de todas as camadas, ordem preservada (fraco → forte). */
  skills: string[];
  timeout?: number; // minutos
}

/**
 * Cada camada é um `Partial<ResolvedConfig>`. `PipelineStage` e
 * `PipelineDefaults` são estruturalmente compatíveis — passe-os direto, sem
 * mapear campo a campo. Camada ausente (`undefined`) é simplesmente ignorada.
 */
export interface RuntimeConfigInput {
  /** Defaults do ambiente/instalação (variáveis de ambiente do backend). */
  env?: Partial<ResolvedConfig>;
  /** `project.settings.defaults` (contratos §4). */
  projectDefaults?: Partial<ResolvedConfig>;
  /** `pipeline.defaults` (contratos §2). */
  pipelineDefaults?: Partial<ResolvedConfig>;
  /** Campos de runtime do `PipelineStage` (contratos §1). */
  stage?: Partial<ResolvedConfig>;
  /** O que o Master passou no `start_macro_task` / `session.context.runtimeOverride`. */
  sessionOverride?: Partial<ResolvedConfig>;
}

export interface RuntimeConfigResolution {
  config: ResolvedConfig;
  /**
   * Campo escalar -> nome da camada que ganhou. Só contém os escalares que
   * alguma camada definiu; vai para o log da sessão para tornar "por que essa
   * sessão subiu com opus?" respondível sem reconstruir o merge na mão.
   *
   * `subagents`/`skills` NÃO aparecem aqui: são união de várias camadas, não
   * têm uma origem única. Use `describeProvenance` para o log legível.
   */
  provenance: Record<string, ConfigLayer>;
}

const SCALAR_KEYS = ['model', 'cliProfile', 'permissionMode'] as const;
const LIST_KEYS = ['subagents', 'skills'] as const;

/**
 * Normaliza um escalar de string vindo de Json/env não confiável. `null`,
 * `undefined`, string vazia e tipos errados contam como AUSENTE — uma camada
 * mal preenchida não deve vencer uma camada mais fraca válida, e env var vazia
 * (`MODEL=`) é o caso comum disso.
 */
function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Timeout em minutos: só número finito positivo conta. */
function cleanTimeout(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/** Itens de lista: descarta não-strings e vazios, preservando a ordem. */
function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter((v): v is string => v !== undefined);
}

export function resolveRuntimeConfig(input: RuntimeConfigInput): RuntimeConfigResolution {
  const config: ResolvedConfig = { subagents: [], skills: [] };
  const provenance: Record<string, ConfigLayer> = {};

  // Uma passada única por camada, do mais fraco para o mais forte: escalar
  // sobrescreve (último válido ganha), lista acumula.
  for (const layer of CONFIG_LAYERS) {
    const values = input[layer];
    if (!values) continue;

    for (const key of SCALAR_KEYS) {
      const value = cleanString(values[key]);
      if (value !== undefined) {
        config[key] = value;
        provenance[key] = layer;
      }
    }

    const timeout = cleanTimeout(values.timeout);
    if (timeout !== undefined) {
      config.timeout = timeout;
      provenance.timeout = layer;
    }

    for (const key of LIST_KEYS) {
      for (const item of cleanList(values[key])) {
        if (!config[key].includes(item)) config[key].push(item);
      }
    }
  }

  return { config, provenance };
}

/**
 * Proveniência em uma linha, para o log da sessão.
 * Ex.: `model=opus (stage), cliProfile=claude (projectDefaults), skills=[sdd, qmd-skill]`
 */
export function describeProvenance(resolution: RuntimeConfigResolution): string {
  const scalars = resolution.config as unknown as Record<string, unknown>;
  const parts = Object.entries(resolution.provenance).map(
    ([key, layer]) => `${key}=${scalars[key]} (${layer})`,
  );
  for (const key of LIST_KEYS) {
    const list = resolution.config[key];
    if (list.length) parts.push(`${key}=[${list.join(', ')}]`);
  }
  return parts.join(', ');
}
