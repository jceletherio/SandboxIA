import { IsString, IsOptional } from 'class-validator';

export class CreateAssignmentDto {
  @IsString()
  phase: string;

  @IsString()
  modelId: string;

  @IsString()
  @IsOptional()
  cliProfileId?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
