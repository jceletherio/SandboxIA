import { Controller, Get, Query } from '@nestjs/common';
import { GithubService } from './github.service';

@Controller('integrations/github')
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  /** Lets the UI warn about a missing/unauthenticated `gh` before the user tries to import. */
  @Get('status')
  status() {
    return this.githubService.status();
  }

  @Get('issues')
  listIssues(
    @Query('repo') repo?: string,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
    @Query('labels') labels?: string,
  ) {
    return this.githubService.listIssues({
      repo,
      state,
      limit: limit ? Number(limit) : undefined,
      labels,
    });
  }
}
