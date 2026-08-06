import { IsArray, ArrayMinSize, ArrayMaxSize } from 'class-validator';

/**
 * Defensive cap on how many macro tasks a single batch call may carry.
 */
export const MACRO_TASK_BATCH_MAX_ITEMS = 500;

/**
 * Body of `POST /projects/:projectId/macro-tasks/batch`.
 *
 * NOTE: `items` is intentionally NOT validated with `@ValidateNested({ each: true })`.
 * The global `ValidationPipe` is configured with `forbidNonWhitelisted: true`, so nested
 * validation would reject the WHOLE request with a 400 as soon as a single item is invalid.
 * The agreed semantics for batch creation are "best effort": valid items are created and
 * invalid ones are reported individually. Each item is therefore validated inside
 * `MacroTasksService.createBatch()` against `CreateMacroTaskDto`, one at a time.
 */
export class BatchCreateMacroTaskDto {
  @IsArray({ message: 'items must be an array of macro tasks.' })
  @ArrayMinSize(1, { message: 'items must contain at least one macro task.' })
  @ArrayMaxSize(MACRO_TASK_BATCH_MAX_ITEMS, {
    message: `items cannot exceed ${MACRO_TASK_BATCH_MAX_ITEMS} macro tasks per batch. Split the import into smaller batches.`,
  })
  items: Record<string, any>[];
}

export interface BatchCreateFailure {
  index: number;
  title: string;
  reason: string;
}

export interface BatchCreateResult<T = any> {
  summary: { total: number; succeeded: number; failed: number };
  created: T[];
  failed: BatchCreateFailure[];
}
