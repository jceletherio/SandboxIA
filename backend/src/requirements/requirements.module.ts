import { Module } from '@nestjs/common';
import { RequirementsController } from './requirements.controller';
import { RequirementsExtractService } from './requirements-extract.service';
import { RequirementsDoctorService } from './requirements-doctor.service';
import { SddPlannerService } from './sdd-planner.service';

@Module({
  controllers: [RequirementsController],
  providers: [RequirementsExtractService, RequirementsDoctorService, SddPlannerService],
  exports: [RequirementsExtractService, RequirementsDoctorService, SddPlannerService],
})
export class RequirementsModule {}