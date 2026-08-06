import { Module } from '@nestjs/common';
import { SseService } from './sse.service';
import { SseController } from './sse.controller';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [SseService],
  controllers: [SseController],
  exports: [SseService],
})
export class SseModule {}
