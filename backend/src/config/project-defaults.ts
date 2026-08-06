/**
 * `project.settings.defaults` (MT-0, contratos §4) — módulo PURO.
 *
 * Chave nova DENTRO do `Json` de `Project.settings`, sem migration. Os campos
 * escalares/listas alimentam a camada `projectDefaults` do
 * `resolveRuntimeConfig`; `masterModel` é a exceção — não é config de sessão, é
 * do Master, e por isso NÃO entra na camada do resolver (ver
 * `projectDefaultsToConfigLayer`).
 *
 * MT-1 constrói a UI sobre `ProjectsService.getDefaults/setDefaults`.
 */
import type { ResolvedConfig } from './resolve-runtime-config';

/** Nome da chave dentro de `project.settings`. */
export const PROJECT_DEFAULTS_KEY = 'defaults';

export interface ProjectDefaults {
  /** Modelo das SESSÕES de código. Ex.: "sonnet". */
  model?: string;
  /** Modelo do MASTER, independente do das sessões. Ex.: "opus". */
  masterModel?: string;
  /** Vira `{{permissionMode}}` nos args do CliProfile. Ex.: "acceptEdits". */
  permissionMode?: string;
  /** CliProfile default das sessões deste projeto. */
  cliProfile?: string;
  /** Skills carregadas em toda sessão do projeto. */
  skills?: string[];
  /** Subagentes sugeridos em toda sessão do projeto. */
  subagents?: string[];
  /** Timeout default de stage, em minutos. */
  timeout?: number;
}

const STRING_FIELDS = ['model', 'masterModel', 'permissionMode', 'cliProfile'] as const;
const LIST_FIELDS = ['skills', 'subagents'] as const;

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Lê o bloco de defaults de um `settings` cru do banco e devolve só o que é
 * válido. Nunca lança: `settings` é Json livre e um valor podre não deve
 * derrubar o start de uma sessão — a validação estrita fica na ESCRITA
 * (`assertValidProjectDefaults`), onde ainda há um humano para corrigir.
 */
export function normalizeProjectDefaults(settings: unknown): ProjectDefaults {
  const raw = (settings as Record<string, unknown> | null | undefined)?.[PROJECT_DEFAULTS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: ProjectDefaults = {};

  for (const field of STRING_FIELDS) {
    const value = cleanString(source[field]);
    if (value !== undefined) out[field] = value;
  }
  for (const field of LIST_FIELDS) {
    if (!Array.isArray(source[field])) continue;
    const items = (source[field] as unknown[])
      .map(cleanString)
      .filter((v): v is string => v !== undefined);
    if (items.length) out[field] = items;
  }
  const timeout = source.timeout;
  if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) {
    out.timeout = timeout;
  }
  return out;
}

/**
 * Validação de ESCRITA: rejeita patch com tipo errado em vez de gravar lixo no
 * Json. Aceita patch parcial (é merge raso) e `null` como "apaga o campo".
 */
export function assertValidProjectDefaults(patch: unknown): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('"defaults" must be a plain object');
  }
  const source = patch as Record<string, unknown>;
  const known = new Set<string>([...STRING_FIELDS, ...LIST_FIELDS, 'timeout']);

  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key)) {
      throw new Error(`Unknown "defaults" field: "${key}" (allowed: ${[...known].join(', ')})`);
    }
    if (value === null) continue; // remoção explícita do campo
    if ((STRING_FIELDS as readonly string[]).includes(key)) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`"defaults.${key}" must be a non-empty string`);
      }
    } else if ((LIST_FIELDS as readonly string[]).includes(key)) {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
        throw new Error(`"defaults.${key}" must be an array of non-empty strings`);
      }
    } else if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error('"defaults.timeout" must be a positive number of minutes');
    }
  }
}

/**
 * Converte os defaults do projeto na camada `projectDefaults` do resolver.
 * `masterModel` fica de fora de propósito: é o modelo do Master, não das
 * sessões — misturá-los faria o Master sequestrar o modelo das sessões.
 */
export function projectDefaultsToConfigLayer(
  defaults: ProjectDefaults,
): Partial<ResolvedConfig> {
  const { masterModel: _masterModel, ...sessionScoped } = defaults;
  return sessionScoped;
}
