import { IsString, IsOptional } from 'class-validator';

export class CreateArtifactDto {
  @IsString()
  type: string;

  @IsString()
  path: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsOptional()
  metadata?: any;
}
