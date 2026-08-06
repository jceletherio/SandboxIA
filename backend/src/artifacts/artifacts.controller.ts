import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { ArtifactsService } from './artifacts.service';
import { CreateArtifactDto } from './dto/create-artifact.dto';

@Controller('sessions/:sessionId/artifacts')
export class ArtifactsController {
  constructor(private readonly artifactsService: ArtifactsService) {}

  @Post()
  create(@Param('sessionId') sessionId: string, @Body() dto: CreateArtifactDto) {
    return this.artifactsService.create(sessionId, dto);
  }

  @Get()
  findAll(@Param('sessionId') sessionId: string) {
    return this.artifactsService.findAll(sessionId);
  }

  @Get(':id')
  findOne(@Param('sessionId') sessionId: string, @Param('id') id: string) {
    return this.artifactsService.findOne(sessionId, id);
  }

  @Delete(':id')
  remove(@Param('sessionId') sessionId: string, @Param('id') id: string) {
    return this.artifactsService.remove(sessionId, id);
  }
}
