import { IsString, IsOptional } from 'class-validator';

export class CreateAgentDto {
  @IsString()
  name: string;

  @IsString()
  type: string;

  @IsString()
  model: string;

  @IsString()
  @IsOptional()
  mcpEndpoint?: string;

  @IsString()
  @IsOptional()
  cliProfileId?: string;

  @IsOptional()
  metadata?: any;
}
