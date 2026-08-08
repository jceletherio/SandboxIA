import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { SddSpecsService } from './sdd-specs.service';

@Controller('projects/:projectId/specs')
export class SddSpecsController {
  constructor(private readonly sddSpecsService: SddSpecsService) {}

  @Get()
  list(@Param('projectId') projectId: string) {
    return this.sddSpecsService.listSpecs(projectId);
  }

  @Get(':nnn')
  get(@Param('projectId') projectId: string, @Param('nnn') nnn: string) {
    return this.sddSpecsService.getSpec(projectId, nnn);
  }

  @Put(':nnn/status')
  updateStatus(@Param('projectId') projectId: string, @Param('nnn') nnn: string, @Body() body: { status: string }) {
    return this.sddSpecsService.updateStatus(projectId, nnn, body.status);
  }

  @Post()
  create(@Param('projectId') projectId: string, @Body() body: { slug: string; variant: string; stack: string }) {
    return this.sddSpecsService.createSpec(projectId, body);
  }
}
