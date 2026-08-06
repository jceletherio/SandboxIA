/**
 * Ponto de importação estável para as outras ondas: `import { ... } from '../config'`.
 * Só reexporta — a lógica vive em `resolve-runtime-config.ts` (módulo puro).
 */
export {
  CONFIG_LAYERS,
  describeProvenance,
  resolveRuntimeConfig,
  type ConfigLayer,
  type ResolvedConfig,
  type RuntimeConfigInput,
  type RuntimeConfigResolution,
} from './resolve-runtime-config';

export {
  assertValidProjectDefaults,
  normalizeProjectDefaults,
  projectDefaultsToConfigLayer,
  PROJECT_DEFAULTS_KEY,
  type ProjectDefaults,
} from './project-defaults';
