import { Controller, Get, Post, Body, Param, Delete, Patch } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

@Controller('agents')
export class GlobalAgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  findAllGlobal() {
    return this.agentsService.findAllGlobal();
  }

}

@Controller('projects/:projectId/agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post()
  create(@Param('projectId') projectId: string, @Body() dto: CreateAgentDto) {
    return this.agentsService.create(projectId, dto);
  }

  @Get()
  findAll(@Param('projectId') projectId: string) {
    return this.agentsService.findAll(projectId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.agentsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agentsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.agentsService.remove(id);
  }
}
