import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, from } from 'rxjs';
import { concatMap, filter } from 'rxjs/operators';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_CHANNELS, CHANNELS } from '../redis/channels';

export interface SseEvent {
  type: string;
  data: any;
  id?: string;
}

export interface SseFilters {
  sessionId?: string;
  projectId?: string;
}

@Injectable()
export class SseService implements OnModuleInit {
  private readonly logger = new Logger(SseService.name);
  // Subject único e multicast: N clientes assinam o mesmo stream com filtro.
  private readonly events$ = new Subject<SseEvent>();
  // Cache sessionId → projectId para o filtro por projeto (sessões não mudam
  // de projeto; entradas somem quando a sessão é deletada).
  private readonly sessionProject = new Map<string, string | null>();

  constructor(
    private redis: RedisService,
    private prisma: PrismaService,
  ) {}

  async onModuleInit() {
    for (const channel of ALL_CHANNELS) {
      await this.redis.subscribe(channel, (data) => {
        this.broadcast(channel, data);
      });
    }
    await this.redis.subscribe(CHANNELS.SESSION_DELETED, (data: any) => {
      if (data?.id) this.sessionProject.delete(data.id);
    });
    this.logger.log(`SSE bridging ${ALL_CHANNELS.length} Redis channels`);
  }

  getEvents(filters: SseFilters = {}): Observable<SseEvent> {
    return this.events$.asObservable().pipe(
      concatMap((event) =>
        from(
          this.matches(event, filters).then((ok) => (ok ? event : null)),
        ),
      ),
      filter((event): event is SseEvent => event !== null),
    );
  }

  /** Eventos session:* carregam o objeto inteiro (campo `id`); os demais usam `sessionId`. */
  private sessionIdOf(event: SseEvent): string | undefined {
    return (
      event.data?.sessionId ??
      (event.type.startsWith('session:') ? event.data?.id : undefined)
    );
  }

  private async matches(event: SseEvent, filters: SseFilters): Promise<boolean> {
    if (filters.sessionId) {
      return this.sessionIdOf(event) === filters.sessionId;
    }
    if (!filters.projectId) return true;

    // Eventos que já carregam o projeto (git:changed) filtram direto, sem lookup
    if (typeof event.data?.projectId === 'string') {
      return event.data.projectId === filters.projectId;
    }

    const sessionId = this.sessionIdOf(event);
    // Eventos sem sessão (master:*, etc.) são globais — sempre passam
    if (!sessionId) return true;

    const projectId = await this.projectOf(sessionId);
    // Sessão desconhecida/deletada: deixa passar para não perder eventos
    return projectId === null || projectId === filters.projectId;
  }

  private async projectOf(sessionId: string): Promise<string | null> {
    if (this.sessionProject.has(sessionId)) {
      return this.sessionProject.get(sessionId) ?? null;
    }
    let projectId: string | null = null;
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { macroTask: { select: { projectId: true } } },
      });
      projectId = session?.macroTask?.projectId ?? null;
    } catch {
      projectId = null;
    }
    // não cacheia null definitivo de sessão inexistente para sempre? cacheia:
    // sessão criada depois republica eventos com o mesmo id — improvável; e o
    // cache é limpo no session:deleted.
    this.sessionProject.set(sessionId, projectId);
    if (this.sessionProject.size > 5000) {
      const firstKey = this.sessionProject.keys().next().value;
      if (firstKey) this.sessionProject.delete(firstKey);
    }
    return projectId;
  }

  broadcast(type: string, data: any) {
    this.events$.next({
      type,
      data,
      id: Date.now().toString(),
    });
  }
}
