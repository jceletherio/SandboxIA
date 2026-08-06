import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateMcpDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  endpoint?: string;

  @IsBoolean()
  @IsOptional()
  connected?: boolean;

  @IsOptional()
  metadata?: any;
}
