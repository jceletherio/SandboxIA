import { IsString, IsOptional, IsDate, IsInt, Min, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body de `POST /scheduled-jobs/master-loop` — o agendamento "de usuário"
 * (instruções em texto livre + recorrência opcional com rate-limit).
 *
 * `runCount` não é aceito do cliente: o service sempre força 0 na criação.
 */
export class CreateMasterLoopDto {
  @IsString()
  @IsNotEmpty()
  instructions: string;

  @IsString()
  @IsNotEmpty()
  projectId: string;

  @Type(() => Date)
  @IsDate()
  scheduledAt: Date;

  /** Ausente = executa uma única vez. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  repeatIntervalMinutes?: number;

  /** Ausente com `repeatIntervalMinutes` presente = repete indefinidamente. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  maxRuns?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
