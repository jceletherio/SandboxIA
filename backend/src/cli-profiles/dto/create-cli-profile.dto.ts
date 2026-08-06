import { IsString, IsOptional, IsArray, IsObject, IsBoolean } from 'class-validator';

export class CreateCliProfileDto {
  @IsString()
  name: string;

  @IsString()
  binary: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  interactiveArgs?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  resumeArgs?: string[];

  @IsString()
  @IsOptional()
  mcpConfigFile?: string;

  @IsObject()
  @IsOptional()
  mcpConfigTemplate?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  env?: Record<string, string>;

  @IsString()
  @IsOptional()
  defaultModel?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
