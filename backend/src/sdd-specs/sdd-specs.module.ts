import { Module } from '@nestjs/common';
import { SddSpecsController } from './sdd-specs.controller';
import { SddSpecsService } from './sdd-specs.service';

@Module({
  controllers: [SddSpecsController],
  providers: [SddSpecsService],
})
export class SddSpecsModule {}
