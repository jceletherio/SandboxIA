import { Controller, Get, Post, Body, Param, Delete, Patch } from '@nestjs/common';
import { CliProfilesService } from './cli-profiles.service';
import { CreateCliProfileDto } from './dto/create-cli-profile.dto';
import { UpdateCliProfileDto } from './dto/update-cli-profile.dto';

@Controller('cli-profiles')
export class CliProfilesController {
  constructor(private readonly cliProfilesService: CliProfilesService) {}

  @Post()
  create(@Body() dto: CreateCliProfileDto) {
    return this.cliProfilesService.create(dto);
  }

  @Get()
  findAll() {
    return this.cliProfilesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.cliProfilesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCliProfileDto) {
    return this.cliProfilesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.cliProfilesService.remove(id);
  }
}
