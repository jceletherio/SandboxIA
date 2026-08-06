/**
 * Vocabulário de estado do orquestrador (MT-15). Ponto de importação estável:
 * `import { ... } from '../domain'`. Só reexporta — a lógica vive nos módulos
 * puros ao lado, no mesmo padrão de `backend/src/config/index.ts`.
 */
export {
  assertMacroTaskStatus,
  invalidMacroTaskStatusMessage,
  isMacroTaskStatus,
  normalizeMacroTaskStatus,
  MACRO_TASK_STATUSES,
  MACRO_TASK_STATUS_ALIASES,
  type MacroTaskStatus,
} from './macro-task-status';

export {
  isSessionActive,
  isSessionAlive,
  isSessionFinished,
  ACTIVE_SESSION_STATUSES,
  FINISHED_SESSION_STATUSES,
  LIVE_SESSION_STATUSES,
} from './session-status';
