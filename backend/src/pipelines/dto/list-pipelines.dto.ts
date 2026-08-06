import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Filtros da listagem de pipelines (MT-17). Antes o browser carregava o
 * projeto inteiro e filtrava em JS — com o backlog crescendo isso não escala.
 *
 * Todos os campos são opcionais e `findAll` sem nenhum deles devolve o projeto
 * inteiro, como antes: `pipelinesApi.list` é chamado por outras páginas e pelas
 * MCP tools do Master, que não passam filtro nenhum.
 *
 * `@Type(() => Number)` é necessário porque query param chega como string e o
 * `ValidationPipe` global roda com `transform: true`.
 */
export class ListPipelinesQueryDto {
  /** Casa por substring no nome, case-insensitive. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['fixed', 'custom'])
  kind?: 'fixed' | 'custom';

  @IsOptional()
  @IsString()
  category?: string;

  /** Uma tag por vez — é o que a UI oferece (select, não multi-select). */
  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  /**
   * Sem `take` não há LIMIT — quem não pagina continua recebendo tudo. O teto
   * de 200 é contra `?take=999999`, que anularia a paginação.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}
