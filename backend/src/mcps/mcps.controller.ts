import { Controller, Get, Post, Body, Param, Delete, Patch, Query } from '@nestjs/common';
import { McpsService } from './mcps.service';
import { CreateMcpDto } from './dto/create-mcp.dto';
import { UpdateMcpDto } from './dto/update-mcp.dto';

@Controller('mcps')
export class McpsController {
  constructor(private readonly mcpsService: McpsService) {}

  @Post()
  create(@Body() dto: CreateMcpDto, @Query('projectId') projectId?: string) {
    return this.mcpsService.create(dto, projectId);
  }

  @Get()
  findAll() {
    return this.mcpsService.findAll();
  }

  @Get('scan')
  scan(@Query('projectId') projectId: string) {
    return this.mcpsService.scan(projectId);
  }

  @Get('scan-global')
  scanGlobal() {
    return this.mcpsService.scanGlobal();
  }

  @Get('project/:projectId')
  getProjectMCPs(@Param('projectId') projectId: string) {
    return this.mcpsService.getProjectMCPs(projectId);
  }

  @Post(':id/inject')
  inject(@Param('id') id: string, @Body('projectId') projectId: string) {
    return this.mcpsService.injectIntoProject(id, projectId);
  }

  @Post(':id/remove')
  removeFromProject(@Param('id') id: string, @Body('projectId') projectId: string) {
    return this.mcpsService.removeFromProject(id, projectId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mcpsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMcpDto) {
    return this.mcpsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.mcpsService.remove(id);
  }

  @Post(':id/connect')
  connect(@Param('id') id: string) {
    return this.mcpsService.connect(id);
  }

  @Post(':id/disconnect')
  disconnect(@Param('id') id: string) {
    return this.mcpsService.disconnect(id);
  }

  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.mcpsService.test(id);
  }
}
