import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { GitService } from './git.service';

@Controller('git')
export class GitController {
  constructor(private readonly gitService: GitService) {}

  @Get('overview')
  overview(@Query('projectId') projectId: string) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.gitService.overview(projectId);
  }

  @Get('log')
  log(
    @Query('projectId') projectId: string,
    @Query('branch') branch?: string,
    @Query('limit') limit?: string,
  ) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.gitService.log(projectId, branch, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('diff')
  diff(@Query('projectId') projectId: string, @Query('branch') branch: string) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.gitService.diff(projectId, branch);
  }
}
