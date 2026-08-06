import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { PipelineEngineService } from './pipeline-engine.service';

@Controller('pipelines/:pipelineId/execute')
export class PipelineExecutionController {
  constructor(private readonly pipelineEngine: PipelineEngineService) {}

  @Post('start')
  async startPipeline(
    @Param('pipelineId') pipelineId: string,
    @Body() body: { macroTaskId: string; agentId: string },
  ) {
    return this.pipelineEngine.startPipeline(body.macroTaskId, body.agentId);
  }

  @Post(':sessionId/advance')
  async advanceStage(@Param('sessionId') sessionId: string) {
    await this.pipelineEngine.advanceToNextStage(sessionId);
    return { success: true };
  }

  @Post(':sessionId/pause')
  async pauseSession(
    @Param('sessionId') sessionId: string,
    @Body() body: { reason: string },
  ) {
    await this.pipelineEngine.pauseSession(sessionId, body.reason);
    return { success: true };
  }

  @Post(':sessionId/resume')
  async resumeSession(@Param('sessionId') sessionId: string) {
    await this.pipelineEngine.resumeSession(sessionId);
    return { success: true };
  }

  @Get(':sessionId/status')
  async getExecutionStatus(@Param('sessionId') sessionId: string) {
    return this.pipelineEngine.getExecutionStatus(sessionId);
  }

  /** Pula o stage atual (marca como skipped e avança o pipeline). */
  @Post(':sessionId/skip-stage')
  async skipStage(
    @Param('sessionId') sessionId: string,
    @Body() body: { reason?: string } = {},
  ) {
    return this.pipelineEngine.skipStage(sessionId, body?.reason);
  }

  @Post(':sessionId/retry-stage')
  async retryStage(
    @Param('pipelineId') pipelineId: string,
    @Param('sessionId') sessionId: string,
  ) {
    await this.pipelineEngine.retryStage(sessionId, pipelineId);
    return { success: true };
  }
}
