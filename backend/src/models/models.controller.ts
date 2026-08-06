import { Controller, Get, Post, Body, Param, Delete, Patch } from '@nestjs/common';
import { ModelsService } from './models.service';
import { CreateModelDto } from './dto/create-model.dto';
import { UpdateModelDto } from './dto/update-model.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';

@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Post()
  create(@Body() dto: CreateModelDto) {
    return this.modelsService.create(dto);
  }

  @Get()
  findAll() {
    return this.modelsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.modelsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateModelDto) {
    return this.modelsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.modelsService.remove(id);
  }

  @Get('assignments/list')
  getAssignments() {
    return this.modelsService.getAssignments();
  }

  @Post('assignments')
  createAssignment(@Body() dto: CreateAssignmentDto) {
    return this.modelsService.createAssignment(dto);
  }

  @Delete('assignments/:id')
  removeAssignment(@Param('id') id: string) {
    return this.modelsService.removeAssignment(id);
  }
}
