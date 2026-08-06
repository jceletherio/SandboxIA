import { IsString, IsOptional } from 'class-validator';

export class CreateQuestionDto {
  @IsString()
  @IsOptional()
  agentId?: string;

  @IsString()
  question: string;

  @IsString()
  @IsOptional()
  priority?: string;

  @IsOptional()
  metadata?: any;
}
