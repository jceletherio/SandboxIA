import { IsString, IsOptional, IsDate, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateScheduledJobDto {
  @IsString()
  type: string;

  /**
   * `@IsObject()` é obrigatório aqui: o `ValidationPipe` global roda com
   * `whitelist + forbidNonWhitelisted`, então uma propriedade sem NENHUM
   * decorator era rejeitada com 400 ("property payload should not exist") —
   * era o que quebrava o POST /scheduled-jobs da página /scheduler.
   * O shape específico de cada `type` é validado no service
   * (ver `validateMasterLoopPayload` para `master_loop`).
   */
  @IsObject()
  @IsOptional()
  payload?: Record<string, any>;

  @Type(() => Date)
  @IsDate()
  scheduledAt: Date;

  @IsString()
  @IsOptional()
  notes?: string;
}
