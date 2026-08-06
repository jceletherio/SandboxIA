import { IsString, IsOptional, IsDefined, IsBoolean } from 'class-validator';

export class CreatePipelineDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  /**
   * Aceita `[...stages]` ou `{ stages: [...] }` — a validação estrutural
   * (nomes únicos, mode válido etc.) é feita no service via
   * validatePipelineDefinition (class-validator @IsObject rejeitava arrays).
   */
  @IsDefined()
  stages: any;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
