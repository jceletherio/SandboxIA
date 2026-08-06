import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CliProfilesController } from './cli-profiles.controller';
import { CliProfilesService } from './cli-profiles.service';

@Module({
  imports: [PrismaModule],
  controllers: [CliProfilesController],
  providers: [CliProfilesService],
  exports: [CliProfilesService],
})
export class CliProfilesModule {}
