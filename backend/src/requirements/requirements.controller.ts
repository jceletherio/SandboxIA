import { Controller, Get, Post, Param, Body, Query, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirementsExtractService } from './requirements-extract.service';
import { RequirementsDoctorService } from './requirements-doctor.service';
import { SddPlannerService } from './sdd-planner.service';

@Controller('projects/:projectId/requirements')
export class RequirementsController {
  constructor(
    private readonly extractService: RequirementsExtractService,
    private readonly doctorService: RequirementsDoctorService,
    private readonly plannerService: SddPlannerService,
  ) {}

  /**
   * Upload a requirements document (.docx/.pdf/.md/.txt) and persist as requirements.md.
   * Delegates extraction to ia-framework extract script.
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    // Save uploaded file to temp location
    const tmpPath = `/tmp/req-${Date.now()}-${file.originalname}`;
    require('fs').writeFileSync(tmpPath, file.buffer);

    // Extract text
    const extractedText = await this.extractService.extractText(tmpPath);

    // Normalize and persist in worktree
    const requirementsPath = await this.extractService.normalizeAndPersist(
      projectId, tmpPath, extractedText,
    );

    // Run health check automatically (always)
    const healthCheck = await this.doctorService.runHealthCheck(projectId);

    return {
      uploaded: file.originalname,
      requirementsPath,
      healthCheck: {
        score: healthCheck.score,
        verdict: healthCheck.verdict,
        findings: healthCheck.findings.length,
        version: healthCheck.version,
        snapshotPath: healthCheck.snapshotPath,
      },
    };
  }

  /**
   * Run health check (requirements-doctor) on requirements.md.
   * Score 0-100, 8 dimensions, persists versioned snapshot.
   */
  @Post('doctor')
  doctor(
    @Param('projectId') projectId: string,
    @Body() body: { strict?: boolean; migration?: boolean; noSave?: boolean } = {},
  ) {
    return this.doctorService.runHealthCheck(projectId, body);
  }

  /**
   * Get health check history (all versions).
   */
  @Get('health')
  healthHistory(@Param('projectId') projectId: string) {
    return this.doctorService.getHealthHistory(projectId);
  }

  /**
   * Get a specific health check version.
   */
  @Get('health/:version')
  healthVersion(
    @Param('projectId') projectId: string,
    @Param('version') version: string,
  ) {
    const v = parseInt(version, 10);
    if (isNaN(v)) throw new BadRequestException('Version must be a number');
    return this.doctorService.getHealthVersion(projectId, v);
  }

  /**
   * Run sdd-planner: reads requirements.md, opens SDD trilhas, writes plan.md.
   */
  @Post('plan')
  plan(
    @Param('projectId') projectId: string,
    @Body() body: { epic?: string; prioridade?: string } = {},
  ) {
    return this.plannerService.plan(projectId, body);
  }
}