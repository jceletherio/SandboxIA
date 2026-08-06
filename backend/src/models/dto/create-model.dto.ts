import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class CreateModelDto {
  @IsString()
  provider: string;

  @IsString()
  name: string;

  @IsNumber()
  @IsOptional()
  contextSize?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
