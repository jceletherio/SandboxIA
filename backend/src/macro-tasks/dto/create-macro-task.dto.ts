import { IsString, IsOptional, IsInt, IsObject } from 'class-validator';

export class CreateMacroTaskDto {
  @IsString()
  pipelineId: string;

  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @IsOptional()
  priority?: number;

  @IsObject()
  @IsOptional()
  metadata?: any;
}
