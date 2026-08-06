import { Controller, Sse, Query, MessageEvent } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { SseService } from './sse.service';

@Controller('sse')
export class SseController {
  constructor(private readonly sseService: SseService) {}

  @Sse('stream')
  stream(
    @Query('sessionId') sessionId?: string,
    @Query('projectId') projectId?: string,
  ): Observable<MessageEvent> {
    return this.sseService.getEvents({ sessionId, projectId }).pipe(
      map((event) => ({
        data: JSON.stringify(event.data),
        type: event.type,
        id: event.id,
      } as MessageEvent)),
    );
  }
}
