import { Test } from '@nestjs/testing';
import { BacklogIngestService, BACKLOG_STATUS } from './backlog-ingest.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { CHANNELS } from '../redis/channels';

/**
 * Ingestão de backlog com Prisma, Redis e ArtifactsService substituídos pelo
 * container de teste do Nest — nenhuma linha é escrita no banco, nenhum canal
 * Redis é assinado de verdade.
 *
 * Este é também o primeiro teste do repo montado com `Test.createTestingModule`
 * (MT-14 instalou `@nestjs/testing`): serve de molde para os serviços com
 * injeção que até aqui ficavam sem cobertura.
 *
 * O que estes testes travam — tudo caminho de falha SILENCIOSA, que roda por
 * evento do Redis sem ninguém olhando:
 * - report ausente é normal (pipeline sem stage de Report) e report ilegível NÃO
 *   é: o segundo tem que virar artefato de diagnóstico + item de dívida;
 * - reprocessar a mesma sessão não duplica item (`skipped`), e uma segunda
 *   sessão vendo a mesma coisa funde em vez de criar (`merged`);
 * - o pipeline do item novo cai no da task de origem quando o nome sugerido não
 *   existe no projeto — sem isso o `create` violaria a FK e o finding sumiria;
 * - `sessionId` que não é string no evento é ignorado sem estourar no publisher.
 */

const SESSION_ID = 'sess-1';
const ORIGIN = {
  id: 'mt-origem',
  projectId: 'proj-1',
  pipelineId: 'pipe-da-origem',
  title: 'MT-99 · task que gerou o report',
};

function reportWith(findings: unknown[]): string {
  return JSON.stringify({ macroTaskId: ORIGIN.id, sessionId: SESSION_ID, summary: 'x', findings });
}

const BUG_FINDING = {
  kind: 'bug',
  title: 'validatePipelineDefinition aceita tags com número',
  detail: 'array de número passa a validação',
  files: ['backend/src/pipelines/pipeline-definition.ts'],
  effort: 's',
  priority: 0,
};

interface Harness {
  service: BacklogIngestService;
  prisma: any;
  artifacts: any;
  redis: any;
  /** Callback registrado em `onModuleInit`, para simular o evento do canal. */
  emitSessionCompleted: (event: any) => void;
}

async function makeHarness(
  options: {
    session?: any;
    report?: { id: string; path: string; content: string | null } | null;
    existingBacklog?: Array<{ id: string; title: string; metadata: any }>;
    pipelines?: Array<{ id: string; name: string }>;
  } = {},
): Promise<Harness> {
  const session =
    options.session === undefined ? { id: SESSION_ID, macroTask: ORIGIN } : options.session;

  const prisma = {
    session: {
      findUnique: jest.fn().mockResolvedValue(session),
      findMany: jest.fn().mockResolvedValue([]),
    },
    macroTask: {
      findMany: jest.fn().mockResolvedValue(options.existingBacklog ?? []),
      findUnique: jest.fn(async ({ where }: any) => ({
        metadata: (options.existingBacklog ?? []).find((item) => item.id === where.id)?.metadata,
      })),
      create: jest.fn(async ({ data }: any) => ({ id: 'mt-novo', title: data.title })),
      update: jest.fn().mockResolvedValue({}),
    },
    pipeline: { findMany: jest.fn().mockResolvedValue(options.pipelines ?? []) },
    sDDArtifact: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'art-erro' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const handlers = new Map<string, (event: any) => void>();
  const redis = {
    subscribe: jest.fn(async (channel: string, callback: (event: any) => void) => {
      handlers.set(channel, callback);
    }),
  };

  const artifacts = {
    findTaskReport: jest
      .fn()
      .mockResolvedValue(
        options.report === undefined
          ? { id: 'art-1', path: 'docs/melhorias/mt-99-task-report.json', content: reportWith([BUG_FINDING]) }
          : options.report,
      ),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      BacklogIngestService,
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redis },
      { provide: ArtifactsService, useValue: artifacts },
    ],
  }).compile();

  return {
    service: moduleRef.get(BacklogIngestService),
    prisma,
    artifacts,
    redis,
    emitSessionCompleted: (event: any) => handlers.get(CHANNELS.SESSION_COMPLETED)?.(event),
  };
}

describe('BacklogIngestService', () => {
  it('materializa o finding como item de backlog com score, origem e seenIn', async () => {
    const h = await makeHarness({ pipelines: [{ id: 'pipe-fix-rapido', name: 'Fix Rápido' }] });

    const result = await h.service.ingestSession(SESSION_ID);

    expect(result).toMatchObject({ created: 1, merged: 0, skipped: 0, errors: [] });
    const { data } = h.prisma.macroTask.create.mock.calls[0][0];
    expect(data).toMatchObject({
      projectId: ORIGIN.projectId,
      pipelineId: 'pipe-fix-rapido',
      title: BUG_FINDING.title,
      status: BACKLOG_STATUS,
      // bug (3) + esforço s (2) + priority 0 = 5 → bucket 2, o topo da fila.
      priority: 2,
    });
    expect(data.metadata.origin).toEqual({
      macroTaskId: ORIGIN.id,
      sessionId: SESSION_ID,
      kind: 'bug',
      artifactId: 'art-1',
    });
    expect(data.metadata.backlog).toMatchObject({ kind: 'bug', effort: 's', score: 5 });
    expect(data.metadata.backlog.seenIn).toHaveLength(1);
    expect(data.metadata.backlog.seenIn[0]).toMatchObject({
      macroTaskId: ORIGIN.id,
      sessionId: SESSION_ID,
    });
  });

  it('cai no pipeline da task de origem quando o nome sugerido não existe no projeto', async () => {
    const h = await makeHarness({ pipelines: [] });

    await h.service.ingestSession(SESSION_ID);

    const { data } = h.prisma.macroTask.create.mock.calls[0][0];
    expect(data.pipelineId).toBe(ORIGIN.pipelineId);
    // O nome fica registrado mesmo sem id: é o que diz que houve fallback.
    expect(data.metadata.suggestedPipeline).toBe('Fix Rápido');
  });

  it('sessão sem task-report não é erro e não cria nada', async () => {
    const h = await makeHarness({ report: null });

    const result = await h.service.ingestSession(SESSION_ID);

    expect(result).toEqual({ sessionId: SESSION_ID, created: 0, merged: 0, skipped: 0, errors: [] });
    expect(h.prisma.macroTask.create).not.toHaveBeenCalled();
  });

  it('sessão inexistente reporta erro sem tocar no banco de macro tasks', async () => {
    const h = await makeHarness({ session: null });

    const result = await h.service.ingestSession(SESSION_ID);

    expect(result.errors).toHaveLength(1);
    expect(result.created).toBe(0);
    expect(h.artifacts.findTaskReport).not.toHaveBeenCalled();
    expect(h.prisma.macroTask.create).not.toHaveBeenCalled();
  });

  it('report ilegível vira artefato de diagnóstico + item de dívida, não silêncio', async () => {
    const h = await makeHarness({
      report: { id: 'art-1', path: 'docs/melhorias/mt-99-task-report.json', content: 'isso não é json' },
    });

    const result = await h.service.ingestSession(SESSION_ID);

    expect(result.created).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(h.prisma.sDDArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: SESSION_ID,
          path: 'docs/melhorias/mt-99-task-report.parse-error.json',
        }),
      }),
    );
    const { data } = h.prisma.macroTask.create.mock.calls[0][0];
    expect(data.title).toContain('[report não parseável]');
    expect(data.metadata.backlog.kind).toBe('debt');
  });

  it('report com findings: [] fecha a task em silêncio — sem item e sem artefato de erro', async () => {
    const h = await makeHarness({
      report: { id: 'art-1', path: 'docs/melhorias/mt-99-task-report.json', content: reportWith([]) },
    });

    const result = await h.service.ingestSession(SESSION_ID);

    // Antes da MT-24 este caso caía no mesmo caminho do JSON quebrado: gerava
    // `.parse-error.json` e uma macro task `[report não parseável]`.
    expect(result).toEqual({ sessionId: SESSION_ID, created: 0, merged: 0, skipped: 0, errors: [] });
    expect(h.prisma.macroTask.create).not.toHaveBeenCalled();
    expect(h.prisma.sDDArtifact.create).not.toHaveBeenCalled();
  });

  it('report que declarou findings e perdeu todos ainda vira item de erro', async () => {
    const h = await makeHarness({
      report: {
        id: 'art-1',
        path: 'docs/melhorias/mt-99-task-report.json',
        // Dois findings declarados, nenhum com `title`: houve perda de informação.
        content: reportWith([{ kind: 'bug' }, 'nem objeto é']),
      },
    });

    const result = await h.service.ingestSession(SESSION_ID);

    expect(result.created).toBe(1);
    expect(h.prisma.sDDArtifact.create).toHaveBeenCalled();
    expect(h.prisma.macroTask.create.mock.calls[0][0].data.title).toContain('[report não parseável]');
  });

  it('a descrição do item carrega a evidência marcada como não verificada', async () => {
    const h = await makeHarness({
      report: {
        id: 'art-1',
        path: 'docs/melhorias/mt-99-task-report.json',
        content: reportWith([
          { ...BUG_FINDING, evidence: ['pipeline-definition.ts:88', 'ts-node -e "…" rodado'] },
        ]),
      },
    });

    await h.service.ingestSession(SESSION_ID);

    const { data } = h.prisma.macroTask.create.mock.calls[0][0];
    expect(data.description).toContain('Evidência (NÃO verificada — reconfira antes de agir):');
    expect(data.description).toContain('- pipeline-definition.ts:88');
    expect(data.metadata.backlog.evidence).toEqual([
      'pipeline-definition.ts:88',
      'ts-node -e "…" rodado',
    ]);
  });

  it('finding sem evidência diz isso na descrição em vez de passar por verificado', async () => {
    const h = await makeHarness();

    await h.service.ingestSession(SESSION_ID);

    const { data } = h.prisma.macroTask.create.mock.calls[0][0];
    expect(data.description).toContain('- (nenhuma) O report não trouxe prova.');
    expect(data.metadata.backlog.evidence).toBeUndefined();
  });

  it('merge acumula a evidência das duas sessões', async () => {
    const h = await makeHarness({
      report: {
        id: 'art-1',
        path: 'docs/melhorias/mt-99-task-report.json',
        content: reportWith([{ ...BUG_FINDING, evidence: ['prova-da-segunda-sessao.ts:10'] }]),
      },
      existingBacklog: [
        {
          id: 'mt-ja-existe',
          title: BUG_FINDING.title,
          metadata: {
            backlog: {
              kind: 'bug',
              effort: 's',
              score: 5,
              files: BUG_FINDING.files,
              evidence: ['prova-da-primeira.ts:1'],
              seenIn: [{ macroTaskId: 'mt-outra', sessionId: 'sess-antiga', at: '2026-08-03T00:00:00.000Z' }],
            },
          },
        },
      ],
    });

    await h.service.ingestSession(SESSION_ID);

    const { data } = h.prisma.macroTask.update.mock.calls[0][0];
    expect(data.metadata.backlog.evidence).toEqual([
      'prova-da-primeira.ts:1',
      'prova-da-segunda-sessao.ts:10',
    ]);
  });

  it('reprocessar a mesma sessão não duplica nem reescreve o item', async () => {
    const h = await makeHarness({
      existingBacklog: [
        {
          id: 'mt-ja-existe',
          title: BUG_FINDING.title,
          metadata: {
            backlog: {
              kind: 'bug',
              effort: 's',
              score: 5,
              files: BUG_FINDING.files,
              seenIn: [{ macroTaskId: ORIGIN.id, sessionId: SESSION_ID, at: '2026-08-04T00:00:00.000Z' }],
            },
          },
        },
      ],
    });

    const result = await h.service.ingestSession(SESSION_ID);

    expect(result).toMatchObject({ created: 0, merged: 0, skipped: 1 });
    expect(h.prisma.macroTask.create).not.toHaveBeenCalled();
    expect(h.prisma.macroTask.update).not.toHaveBeenCalled();
  });

  it('segunda sessão vendo a mesma coisa funde: soma seenIn e sobe o score', async () => {
    const h = await makeHarness({
      existingBacklog: [
        {
          id: 'mt-ja-existe',
          title: BUG_FINDING.title,
          metadata: {
            outraChave: 'preservar',
            backlog: {
              kind: 'bug',
              effort: 's',
              score: 5,
              files: ['backend/src/pipelines/pipeline-definition.ts'],
              seenIn: [{ macroTaskId: 'mt-outra', sessionId: 'sess-antiga', at: '2026-08-03T00:00:00.000Z' }],
            },
          },
        },
      ],
    });

    const result = await h.service.ingestSession(SESSION_ID);

    expect(result).toMatchObject({ created: 0, merged: 1, skipped: 0 });
    const { where, data } = h.prisma.macroTask.update.mock.calls[0][0];
    expect(where).toEqual({ id: 'mt-ja-existe' });
    // 5 (base) + 1 sessão extra = 6, ainda bucket 2.
    expect(data.metadata.backlog.score).toBe(6);
    expect(data.metadata.backlog.seenIn).toHaveLength(2);
    // Chave alheia dentro de `metadata` não pode ser apagada pelo merge.
    expect(data.metadata.outraChave).toBe('preservar');
  });

  it('evento sem sessionId string é ignorado sem estourar no publisher', async () => {
    const h = await makeHarness();
    await h.service.onModuleInit();

    expect(h.redis.subscribe).toHaveBeenCalledWith(CHANNELS.SESSION_COMPLETED, expect.any(Function));
    expect(() => h.emitSessionCompleted({ sessionId: 42 })).not.toThrow();
    expect(() => h.emitSessionCompleted(undefined)).not.toThrow();
    expect(h.prisma.session.findUnique).not.toHaveBeenCalled();
  });
});
