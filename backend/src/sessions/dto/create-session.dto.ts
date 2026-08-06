import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  macroTaskId: string;

  @IsString()
  agentId: string;

  @IsString()
  branchName: string;

  @IsString()
  worktreePath: string;

  @IsString()
  currentStage: string;

  @IsObject()
  @IsOptional()
  stageData?: any;

  @IsObject()
  @IsOptional()
  context?: any;
}
