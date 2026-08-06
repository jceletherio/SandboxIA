import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

/**
 * `settings.defaults` (contratos §4) com Prisma mockado — nada é escrito no banco.
 *
 * O que estes testes travam:
 * - o merge é RASO dentro de `defaults` e **preserva as outras chaves** de
 *   `settings` (`maxSessions` não pode desaparecer ao salvar um modelo);
 * - campo desconhecido gravado por outra onda **sobrevive** ao merge — a versão
 *   antiga do normalizador não pode apagar dado que ela não conhece;
 * - `null` no patch REMOVE o campo (é como a UI apaga um default);
 * - patch inválido é 400 e **não escreve nada**.
 */
function makeHarness(settings: any) {
  const updates: any[] = [];
  const prisma = {
    project: {
      findUnique: jest.fn(async () => (settings === undefined ? null : { settings })),
      update: jest.fn(async ({ data }: any) => {
        updates.push(data);
        return { settings: data.settings };
      }),
    },
  };
  return { service: new ProjectsService(prisma as any), prisma, updates };
}

describe('ProjectsService.getDefaults', () => {
  it('devolve {} quando não há defaults gravados', async () => {
    const { service } = makeHarness({ maxSessions: 4 });
    await expect(service.getDefaults('p1')).resolves.toEqual({});
  });

  it('devolve os defaults normalizados e descarta campo podre', async () => {
    const { service } = makeHarness({ defaults: { model: 'sonnet', timeout: -1 } });
    await expect(service.getDefaults('p1')).resolves.toEqual({ model: 'sonnet' });
  });

  it('404 em projeto inexistente', async () => {
    const { service } = makeHarness(undefined);
    await expect(service.getDefaults('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('ProjectsService.setDefaults', () => {
  it('faz merge raso dentro de defaults preservando as outras chaves de settings', async () => {
    const { service, updates } = makeHarness({
      maxSessions: 4,
      masterAgentProfile: 'claude',
      defaults: { model: 'sonnet', timeout: 45 },
    });

    await service.setDefaults('p1', { model: 'opus' });

    expect(updates).toHaveLength(1);
    expect(updates[0].settings).toEqual({
      maxSessions: 4,
      masterAgentProfile: 'claude',
      defaults: { model: 'opus', timeout: 45 },
    });
  });

  it('preserva campo desconhecido já gravado em defaults (não destrói dado de outra onda)', async () => {
    const { service, updates } = makeHarness({
      defaults: { model: 'sonnet', campoDeOutraOnda: 'valor' },
    });

    await service.setDefaults('p1', { model: 'opus' });

    expect(updates[0].settings.defaults).toEqual({
      model: 'opus',
      campoDeOutraOnda: 'valor',
    });
  });

  it('null no patch remove o campo', async () => {
    const { service, updates } = makeHarness({ defaults: { model: 'sonnet', cliProfile: 'claude' } });

    const result = await service.setDefaults('p1', { cliProfile: null });

    expect(updates[0].settings.defaults).toEqual({ model: 'sonnet' });
    expect(result).toEqual({ model: 'sonnet' });
  });

  it('cria o bloco defaults quando ainda não existe', async () => {
    const { service, updates } = makeHarness({ maxSessions: 3 });
    await service.setDefaults('p1', { model: 'opus', skills: ['sdd'] });
    expect(updates[0].settings).toEqual({
      maxSessions: 3,
      defaults: { model: 'opus', skills: ['sdd'] },
    });
  });

  it('400 em patch inválido, sem escrever', async () => {
    const { service, prisma, updates } = makeHarness({ defaults: {} });
    await expect(service.setDefaults('p1', { timeout: 0 })).rejects.toThrow(BadRequestException);
    await expect(service.setDefaults('p1', { modelo: 'opus' })).rejects.toThrow(BadRequestException);
    expect(updates).toHaveLength(0);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});
