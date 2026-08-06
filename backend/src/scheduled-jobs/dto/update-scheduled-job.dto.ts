import { IsString, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateScheduledJobDto } from './create-scheduled-job.dto';

export class UpdateScheduledJobDto extends PartialType(CreateScheduledJobDto) {
  @IsString()
  @IsOptional()
  status?: string;
}
