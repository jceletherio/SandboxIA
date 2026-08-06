import { IsString, IsOptional, IsInt, IsBoolean, Min, Max } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  repoUrl: string;

  @IsString()
  mainPath: string;

  @IsString()
  worktreeBase: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(20)
  maxSessions?: number;

  /**
   * Marca o projeto como template de configuração.
   * Precisa estar declarado aqui (e portanto no UpdateProjectDto, via PartialType)
   * porque o ValidationPipe global roda com `forbidNonWhitelisted: true` —
   * sem isto o PATCH /projects/:id com { isTemplate } responderia 400.
   */
  @IsBoolean()
  @IsOptional()
  isTemplate?: boolean;
}
