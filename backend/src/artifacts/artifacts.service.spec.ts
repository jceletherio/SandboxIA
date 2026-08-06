import { NotFoundException } from '@nestjs/common';
import { ArtifactsService } from './artifacts.service';

/**
 * Escopo por sessão nas rotas `sessions/:sessionId/artifacts/:id` (MT-12). Sem
 * ele, `GET`/`DELETE` com um sessionId qualquer alcançavam artefato de outra
 * sessão — falha silenciosa: respondia 200, nada aparecia no log.
 *
 * Prisma fake aplicando o MESMO `where` que o serviço monta: se o teste
 * casasse só pelo `id`, estaria validando o fake em vez da query.
 */
interface FakeArtifact {
  id: string;
  sessionId: string;
  content: string;
}

const ROWS: FakeArtifact[] = [
  { id: 'art-1', sessionId: 'sess-a', content: 'da sessão A' },
  { id: 'art-2', sessionId: 'sess-b', content: 'segredo da sessão B' },
];

function makeHarness() {
  const rows = ROWS.map((row) => ({ ...row }));
  const deleted: string[] = [];

  const prisma = {
    sDDArtifact: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          rows.find((row) =>
            Object.entries(where).every(([field, value]) => (row as any)[field] === value),
          ) ?? null,
      ),
      delete: jest.fn(async ({ where }: any) => {
        deleted.push(where.id);
        return rows.find((row) => row.id === where.id)!;
      }),
    },
  } as any;

  return { service: new ArtifactsService(prisma), prisma, deleted };
}

describe('ArtifactsService — escopo por sessão', () => {
  it('findOne devolve o artefato quando ele é da sessão da rota', async () => {
    const { service } = makeHarness();

    await expect(service.findOne('sess-a', 'art-1')).resolves.toMatchObject({
      id: 'art-1',
      sessionId: 'sess-a',
    });
  });

  it('findOne dá 404 para artefato de outra sessão (IDOR)', async () => {
    const { service } = makeHarness();

    await expect(service.findOne('sess-a', 'art-2')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove dá 404 para artefato de outra sessão e NÃO apaga', async () => {
    const { service, deleted } = makeHarness();

    await expect(service.remove('sess-a', 'art-2')).rejects.toBeInstanceOf(NotFoundException);
    expect(deleted).toEqual([]);
  });

  it('remove apaga o artefato da própria sessão', async () => {
    const { service, deleted } = makeHarness();

    await expect(service.remove('sess-b', 'art-2')).resolves.toMatchObject({ id: 'art-2' });
    expect(deleted).toEqual(['art-2']);
  });

  it('sessionId inexistente não alcança artefato nenhum', async () => {
    const { service } = makeHarness();

    await expect(service.findOne('sess-fantasma', 'art-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
