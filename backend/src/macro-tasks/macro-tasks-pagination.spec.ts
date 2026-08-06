import { MacroTasksService } from './macro-tasks.service';

/**
 * Paginação por cursor de `findAll` (MT-12). O fake do Prisma é hostil de
 * propósito: quando a query NÃO manda `orderBy`, ele devolve as linhas em ordem
 * diferente a cada chamada. Não é maldade gratuita — é o que o Postgres tem
 * licença para fazer sem ordenação explícita, e é a razão do bug: cursor
 * pressupõe ordem estável, então a página 2 repetia ou perdia item. Tirar o
 * `orderBy` do serviço faz este arquivo ficar vermelho.
 *
 * O dataset tem `createdAt` REPETIDO de propósito: sem o `id` como desempate a
 * ordem dentro do empate também é livre.
 */
interface FakeTask {
  id: string;
  createdAt: Date;
}

const T3 = new Date('2026-08-03T10:00:00.000Z');
const T2 = new Date('2026-08-02T10:00:00.000Z');
const T1 = new Date('2026-08-01T10:00:00.000Z');

const ROWS: FakeTask[] = [
  { id: 'a', createdAt: T2 },
  { id: 'b', createdAt: T1 },
  { id: 'c', createdAt: T3 },
  { id: 'd', createdAt: T2 },
  { id: 'e', createdAt: T3 },
  { id: 'f', createdAt: T1 },
];

/** Ordem esperada por `[{ createdAt: 'desc' }, { id: 'desc' }]`. */
const EXPECTED_ORDER = ['e', 'c', 'd', 'a', 'f', 'b'];

function applyOrderBy(rows: FakeTask[], orderBy: any): FakeTask[] {
  const keys: any[] = Array.isArray(orderBy) ? orderBy : [orderBy];
  return rows.slice().sort((left, right) => {
    for (const key of keys) {
      const [field, direction] = Object.entries(key)[0] as [string, string];
      const a = (left as any)[field];
      const b = (right as any)[field];
      if (a === b || (a instanceof Date && b instanceof Date && +a === +b)) continue;
      const cmp = a < b ? -1 : 1;
      return direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function makeHarness() {
  let calls = 0;

  const prisma = {
    macroTask: {
      findMany: jest.fn(async ({ orderBy, cursor, take, skip }: any) => {
        calls += 1;
        let ordered: FakeTask[];
        if (orderBy) {
          ordered = applyOrderBy(ROWS, orderBy);
        } else {
          // Sem ordenação explícita: rotaciona a cada chamada. É a licença que
          // o Postgres tem e que quebrava a paginação.
          const rotate = calls % ROWS.length;
          ordered = [...ROWS.slice(rotate), ...ROWS.slice(0, rotate)];
        }
        let start = 0;
        if (cursor) {
          const index = ordered.findIndex((row) => row.id === cursor.id);
          if (index < 0) return [];
          start = index + (skip ?? 0);
        }
        return ordered.slice(start, start + take);
      }),
    },
  } as any;

  return { service: new MacroTasksService(prisma), prisma };
}

describe('MacroTasksService.findAll — paginação por cursor', () => {
  it('pede ordem estável ao Prisma, com o id como desempate', async () => {
    const { service, prisma } = makeHarness();

    await service.findAll('proj-1', undefined, 3);

    expect(prisma.macroTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    );
  });

  it('duas páginas cobrem o conjunto inteiro, sem repetir nem perder item', async () => {
    const { service } = makeHarness();

    const first = await service.findAll('proj-1', undefined, 3);
    expect(first.data.map((task: any) => task.id)).toEqual(EXPECTED_ORDER.slice(0, 3));
    expect(first.nextCursor).toBe('d');

    const second = await service.findAll('proj-1', first.nextCursor!, 3);
    expect(second.data.map((task: any) => task.id)).toEqual(EXPECTED_ORDER.slice(3));
    // Fim do conjunto: nada além da página 2.
    expect(second.nextCursor).toBeNull();

    const seen = [...first.data, ...second.data].map((task: any) => task.id);
    expect(seen).toEqual(EXPECTED_ORDER);
    expect(new Set(seen).size).toBe(ROWS.length);
  });

  it('a ordem não depende de quantas queries já rodaram', async () => {
    const { service } = makeHarness();

    await service.findAll('proj-1', undefined, 3);
    await service.findAll('proj-1', undefined, 3);
    const third = await service.findAll('proj-1', undefined, 6);

    expect(third.data.map((task: any) => task.id)).toEqual(EXPECTED_ORDER);
  });
});
