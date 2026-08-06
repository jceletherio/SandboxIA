import { IsOptional, IsString } from 'class-validator';

/**
 * DTO próprio porque o `ValidationPipe` global roda com
 * `forbidNonWhitelisted: true`: qualquer campo não declarado devolve 400.
 */
export class PromoteMacroTaskDto {
  /** Pipeline escolhido na promoção. Ausente = mantém o sugerido pelo esforço. */
  @IsString()
  @IsOptional()
  pipelineId?: string;
}

export class IngestBacklogDto {
  /** Ausente = varre todas as sessões do projeto (backfill). */
  @IsString()
  @IsOptional()
  sessionId?: string;
}
