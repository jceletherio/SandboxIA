import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArtifactDto } from './dto/create-artifact.dto';

@Injectable()
export class ArtifactsService {
  constructor(private prisma: PrismaService) {}

  async create(sessionId: string, dto: CreateArtifactDto) {
    return this.prisma.sDDArtifact.create({
      data: {
        ...dto,
        sessionId,
      },
    });
  }

  async findAll(sessionId: string) {
    return this.prisma.sDDArtifact.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A rota é `sessions/:sessionId/artifacts/:id`, então o `sessionId` é parte da
   * identidade do recurso — não decoração de URL. Buscar só pelo `id` devolvia
   * artefato de OUTRA sessão com 200 (IDOR), e `findAll` filtrando certo fazia a
   * inconsistência passar batida. 404 (e não 403) quando não casa: para quem
   * pede, artefato de outra sessão simplesmente não existe naquela rota.
   */
  async findOne(sessionId: string, id: string) {
    const artifact = await this.prisma.sDDArtifact.findFirst({
      where: { id, sessionId },
    });
    if (!artifact) throw new NotFoundException('Artifact not found');
    return artifact;
  }

  /**
   * Report de fim de macro task da sessão (contratos §6). O `OR` não é
   * paranoia: os reports da Onda 0/1 foram gravados com `type: "other"` porque
   * o enum do `save_artifact` ainda não aceitava `task-report`, e casar só pelo
   * `type` perderia justamente os findings que semeiam o primeiro backlog.
   *
   * Devolve o mais recente quando a sessão gravou mais de um (retentativa de
   * stage grava de novo com o mesmo `path`).
   */
  async findTaskReport(sessionId: string) {
    return this.prisma.sDDArtifact.findFirst({
      where: {
        sessionId,
        OR: [{ type: 'task-report' }, { path: { endsWith: '-task-report.json' } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(sessionId: string, id: string) {
    // O `findOne` escopado é o gate: sem ele o DELETE apagava artefato de outra
    // sessão. `delete` continua por `id` porque a checagem já aconteceu.
    await this.findOne(sessionId, id);
    return this.prisma.sDDArtifact.delete({ where: { id } });
  }
}
