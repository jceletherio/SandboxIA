import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

/**
 * Body de `POST /projects/:templateId/clone`.
 *
 * Os caminhos são **obrigatórios e próprios do projeto novo** — nunca herdados do
 * template. Dois projetos apontando para o mesmo `worktreeBase`/`mainPath` levariam
 * a colisão de worktree e corrupção de repositório.
 */
export class CloneProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  repoUrl: string;

  @IsString()
  @IsNotEmpty()
  mainPath: string;

  @IsString()
  @IsNotEmpty()
  worktreeBase: string;

  @IsString()
  @IsOptional()
  description?: string;
}
