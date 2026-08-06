import { Controller, Get, Post, Body, Param, Delete, Patch } from '@nestjs/common';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { CreateScheduledJobDto } from './dto/create-scheduled-job.dto';
import { UpdateScheduledJobDto } from './dto/update-scheduled-job.dto';
import { CreateMasterLoopDto } from './dto/create-master-loop.dto';

@Controller('scheduled-jobs')
export class ScheduledJobsController {
  constructor(private readonly scheduledJobsService: ScheduledJobsService) {}

  @Post()
  create(@Body() dto: CreateScheduledJobDto) {
    return this.scheduledJobsService.create(dto);
  }

  /**
   * Agendamento "de usuário": instruções em texto livre para o terminal do
   * Master, uma vez ou em loop com rate-limit. É o que a página /scheduler usa
   * no form principal (nada de payload JSON cru).
   */
  @Post('master-loop')
  createMasterLoop(@Body() dto: CreateMasterLoopDto) {
    return this.scheduledJobsService.createMasterLoopFromDto(dto);
  }

  @Get()
  findAll() {
    return this.scheduledJobsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.scheduledJobsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateScheduledJobDto) {
    return this.scheduledJobsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.scheduledJobsService.remove(id);
  }
}
