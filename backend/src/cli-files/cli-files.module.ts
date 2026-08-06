import { Module } from '@nestjs/common';
import { CliFilesService } from './cli-files.service';
import { CliFilesController, CliLibraryController } from './cli-files.controller';

@Module({
  controllers: [CliFilesController, CliLibraryController],
  providers: [CliFilesService],
  exports: [CliFilesService],
})
export class CliFilesModule {}
