import {
  applySchedulingPatch,
  assertValidSchedulingPatch,
  computeNextTickAt,
  computeTickIntervalMinutes,
  DEFAULT_SCHEDULING_CONFIG,
  LEGACY_INTERVAL_FIELDS,
  loadSchedulingConfig,
  normalizeSchedulingConfig,
  persistSchedulingConfig,
  schedulingConfigsEqual,
  type SchedulingConfig,
} from './master-scheduling.config';

/** Fakes mínimos — só o que `load/persistSchedulingConfig` de fato chama. */
function fakePrisma(project: { settings: unknown } | null) {
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue(project),
      update: jest.fn().mockResolvedValue(project),
    },
  } as any;
}

function fakeRedis(cachedGet: string | null = null) {
  const client = { get: jest.fn().mockResolvedValue(cachedGet), set: jest.fn().mockResolvedValue('OK') };
  return { getClient: () => client } as any;
}

describe('normalizeSchedulingConfig', () => {
  it('devolve o default para Json ausente, null ou tipo errado', () => {
    expect(normalizeSchedulingConfig(undefined)).toEqual(DEFAULT_SCHEDULING_CONFIG);
    expect(normalizeSchedulingConfig(null)).toEqual(DEFAULT_SCHEDULING_CONFIG);
    expect(normalizeSchedulingConfig([])).toEqual(DEFAULT_SCHEDULING_CONFIG);
    expect(normalizeSchedulingConfig('sonnet')).toEqual(DEFAULT_SCHEDULING_CONFIG);
  });

  it('lê os campos válidos e clampa os numéricos no mínimo permitido', () => {
    const out = normalizeSchedulingConfig({
      tickIntervalMinutes: 0,
      autoTriageEnabled: false,
      repromptAfterMs: 1_000,
      statusReportEnabled: true,
    });
    expect(out.tickIntervalMinutes).toBe(1);
    expect(out.autoTriageEnabled).toBe(false);
    expect(out.repromptAfterMs).toBe(60_000);
    expect(out.statusReportEnabled).toBe(true);
  });

  it('campo podre cai no default sem derrubar o resto', () => {
    const out = normalizeSchedulingConfig({
      tickIntervalMinutes: 'dez' as unknown as number,
      autoTriageEnabled: 'sim' as unknown as boolean,
      stalledAfterMinutes: 30,
    });
    expect(out.tickIntervalMinutes).toBe(DEFAULT_SCHEDULING_CONFIG.tickIntervalMinutes);
    expect(out.autoTriageEnabled).toBe(DEFAULT_SCHEDULING_CONFIG.autoTriageEnabled);
    expect(out.stalledAfterMinutes).toBe(30);
  });
});

describe('normalizeSchedulingConfig — config gravada antes da MT-28', () => {
  it('deriva o tick do menor intervalo habilitado (config real do OneQuest)', () => {
    // O que está em `Project.settings.automation` do OneQuest hoje. A cadência
    // efetiva do timer da MT-27 era 20 min (o `Math.min`); ler isso não pode
    // deixar o Master mais lento nem mais rápido do que já estava.
    const out = normalizeSchedulingConfig({
      sweepIntervalMinutes: 30,
      sessionCheckIntervalMinutes: 40,
      statusReportEnabled: true,
      statusReportIntervalMinutes: 20,
    });
    expect(out.tickIntervalMinutes).toBe(20);
    expect(out.statusReportEnabled).toBe(true);
  });

  it('ignora o intervalo de parte desabilitada ao derivar', () => {
    const out = normalizeSchedulingConfig({
      autoTriageEnabled: false,
      sweepIntervalMinutes: 2,
      sessionCheckIntervalMinutes: 30,
      statusReportEnabled: false,
      statusReportIntervalMinutes: 5,
    });
    expect(out.tickIntervalMinutes).toBe(30);
  });

  it('nenhuma parte habilitada: cai no menor intervalo presente, que é a intenção gravada', () => {
    const out = normalizeSchedulingConfig({
      autoTriageEnabled: false,
      sessionCheckEnabled: false,
      statusReportEnabled: false,
      sweepIntervalMinutes: 45,
      sessionCheckIntervalMinutes: 25,
    });
    expect(out.tickIntervalMinutes).toBe(25);
  });

  it('não clampa a cadência pra cima: sweep de 1 min continua 1 min', () => {
    const out = normalizeSchedulingConfig({ sweepIntervalMinutes: 1 });
    expect(out.tickIntervalMinutes).toBe(1);
  });

  it('o campo novo ganha do legado quando os dois estão gravados', () => {
    const out = normalizeSchedulingConfig({ tickIntervalMinutes: 8, sweepIntervalMinutes: 30 });
    expect(out.tickIntervalMinutes).toBe(8);
  });

  it('sem nenhum campo de intervalo fica no default', () => {
    expect(normalizeSchedulingConfig({ autoTriageEnabled: true }).tickIntervalMinutes).toBe(
      DEFAULT_SCHEDULING_CONFIG.tickIntervalMinutes,
    );
  });
});

describe('assertValidSchedulingPatch', () => {
  it('aceita patch parcial válido', () => {
    expect(() => assertValidSchedulingPatch({ tickIntervalMinutes: 5 })).not.toThrow();
  });

  it('rejeita campo desconhecido', () => {
    expect(() => assertValidSchedulingPatch({ modelo: 'opus' })).toThrow(/Unknown scheduling field/);
  });

  it('rejeita tipo errado em campo conhecido', () => {
    expect(() => assertValidSchedulingPatch({ tickIntervalMinutes: '5' })).toThrow(/finite number/);
    expect(() => assertValidSchedulingPatch({ autoTriageEnabled: 'true' })).toThrow(/boolean/);
  });

  it('rejeita patch que não é objeto simples', () => {
    expect(() => assertValidSchedulingPatch(null)).toThrow();
    expect(() => assertValidSchedulingPatch([1, 2])).toThrow();
  });

  it('tolera os intervalos legados: aba aberta antes do deploy não vira 500 no save', () => {
    for (const field of LEGACY_INTERVAL_FIELDS) {
      expect(() => assertValidSchedulingPatch({ [field]: 30 })).not.toThrow();
    }
    // Vem no MESMO patch que o rascunho novo — e não contamina o que é aplicado.
    expect(() =>
      assertValidSchedulingPatch({ tickIntervalMinutes: 12, sweepIntervalMinutes: 30 }),
    ).not.toThrow();
    const legacyPatch = { tickIntervalMinutes: 12, sweepIntervalMinutes: 30 } as unknown as Partial<
      SchedulingConfig
    >;
    const next = applySchedulingPatch(DEFAULT_SCHEDULING_CONFIG, legacyPatch);
    expect(next.tickIntervalMinutes).toBe(12);
    expect(schedulingConfigsEqual(next, { ...DEFAULT_SCHEDULING_CONFIG, tickIntervalMinutes: 12 })).toBe(
      true,
    );
  });
});

describe('applySchedulingPatch', () => {
  it('mantém os campos não tocados e clampa o que muda', () => {
    const next = applySchedulingPatch(DEFAULT_SCHEDULING_CONFIG, { tickIntervalMinutes: 0 });
    expect(next.tickIntervalMinutes).toBe(1);
    expect(next.stalledAfterMinutes).toBe(DEFAULT_SCHEDULING_CONFIG.stalledAfterMinutes);
  });
});

describe('schedulingConfigsEqual — base do save idempotente', () => {
  it('true para o mesmo valor em objetos diferentes', () => {
    expect(schedulingConfigsEqual(DEFAULT_SCHEDULING_CONFIG, { ...DEFAULT_SCHEDULING_CONFIG })).toBe(
      true,
    );
  });

  it('false quando um campo muda', () => {
    const changed = applySchedulingPatch(DEFAULT_SCHEDULING_CONFIG, { tickIntervalMinutes: 20 });
    expect(schedulingConfigsEqual(DEFAULT_SCHEDULING_CONFIG, changed)).toBe(false);
  });
});

describe('computeNextTickAt', () => {
  const armedAt = Date.UTC(2026, 0, 1, 0, 0, 0);

  it('é o instante em que o timer foi armado mais um intervalo, sem arredondar', () => {
    const config = { ...DEFAULT_SCHEDULING_CONFIG, autoTriageEnabled: true, tickIntervalMinutes: 30 };
    expect(computeNextTickAt(config, armedAt)).toBe(new Date(armedAt + 30 * 60_000).toISOString());
  });

  it('o horário não depende de quais partes estão ligadas — é o tick, não a parte', () => {
    const base = { ...DEFAULT_SCHEDULING_CONFIG, tickIntervalMinutes: 20 };
    const soTriagem = { ...base, sessionCheckEnabled: false, statusReportEnabled: false };
    const tudo = { ...base, sessionCheckEnabled: true, statusReportEnabled: true };
    expect(computeNextTickAt(soTriagem, armedAt)).toBe(computeNextTickAt(tudo, armedAt));
  });

  it('tudo desabilitado: sem cadência, nenhum disparo prometido', () => {
    const config = {
      ...DEFAULT_SCHEDULING_CONFIG,
      autoTriageEnabled: false,
      sessionCheckEnabled: false,
      statusReportEnabled: false,
    };
    expect(computeNextTickAt(config, armedAt)).toBeNull();
  });
});

describe('computeTickIntervalMinutes — cadência do timer único (MT-28)', () => {
  it('é o tickIntervalMinutes, sem depender de quantas partes estão ligadas', () => {
    const config = {
      ...DEFAULT_SCHEDULING_CONFIG,
      tickIntervalMinutes: 20,
      statusReportEnabled: true,
    };
    expect(computeTickIntervalMinutes(config)).toBe(20);
    expect(computeTickIntervalMinutes({ ...config, statusReportEnabled: false })).toBe(20);
  });

  it('auto-start sozinho ainda arma o tick', () => {
    const config = {
      ...DEFAULT_SCHEDULING_CONFIG,
      autoTriageEnabled: false,
      sessionCheckEnabled: false,
      statusReportEnabled: false,
      autoStartEnabled: true,
      tickIntervalMinutes: 7,
    };
    expect(computeTickIntervalMinutes(config)).toBe(7);
  });

  it('reciclagem de contexto sozinha não arma tick — não há contexto sendo gasto', () => {
    const config = {
      ...DEFAULT_SCHEDULING_CONFIG,
      autoTriageEnabled: false,
      sessionCheckEnabled: false,
      statusReportEnabled: false,
      contextRecycleEnabled: true,
    };
    expect(computeTickIntervalMinutes(config)).toBeNull();
  });

  it('null quando nada está habilitado', () => {
    const config = {
      ...DEFAULT_SCHEDULING_CONFIG,
      autoTriageEnabled: false,
      sessionCheckEnabled: false,
      statusReportEnabled: false,
    };
    expect(computeTickIntervalMinutes(config)).toBeNull();
  });
});

describe('campos novos da MT-27', () => {
  it('nascem desligados — atualizar o backend não liga automação sozinha', () => {
    expect(DEFAULT_SCHEDULING_CONFIG.autoStartEnabled).toBe(false);
    expect(DEFAULT_SCHEDULING_CONFIG.contextRecycleEnabled).toBe(false);
  });

  it('são aceitos pelo PATCH e clampados no mínimo', () => {
    expect(() =>
      assertValidSchedulingPatch({ autoStartEnabled: true, autoStartMaxPerTick: 2 }),
    ).not.toThrow();
    expect(() => assertValidSchedulingPatch({ contextRecycleAfterTicks: '10' })).toThrow(
      /finite number/,
    );
    const next = applySchedulingPatch(DEFAULT_SCHEDULING_CONFIG, {
      autoStartMaxPerTick: 0,
      contextRecycleAfterTicks: 1,
    });
    expect(next.autoStartMaxPerTick).toBe(1);
    expect(next.contextRecycleAfterTicks).toBe(2);
  });
});

describe('loadSchedulingConfig — shape antigo nas três origens de leitura', () => {
  // Logo depois do deploy da MT-28 as três origens ainda têm o shape de antes:
  // o cache quente do Redis, o `Project.settings.automation` e a chave global
  // legada pré-MT-2. Todas passam pelo `normalize`, então todas derivam o tick.
  const legacy = {
    sweepIntervalMinutes: 30,
    sessionCheckIntervalMinutes: 40,
    statusReportEnabled: true,
    statusReportIntervalMinutes: 20,
  };

  it('cache do Redis com o shape antigo é derivado, não servido cru', async () => {
    const config = await loadSchedulingConfig(fakePrisma({ settings: {} }), fakeRedis(JSON.stringify(legacy)), 'p1');
    expect(config.tickIntervalMinutes).toBe(20);
    expect(config).not.toHaveProperty('sweepIntervalMinutes');
  });

  it('Project.settings.automation com o shape antigo é derivado', async () => {
    const prisma = fakePrisma({ settings: { automation: legacy } });
    const config = await loadSchedulingConfig(prisma, fakeRedis(null), 'p1');
    expect(config.tickIntervalMinutes).toBe(20);
  });
});

describe('loadSchedulingConfig — projeto que não existe mais', () => {
  it('devolve o default sem lançar (não tenta persistir numa linha que não existe)', async () => {
    const prisma = fakePrisma(null);
    const redis = fakeRedis(null);
    await expect(loadSchedulingConfig(prisma, redis, 'projeto-deletado')).resolves.toEqual(
      DEFAULT_SCHEDULING_CONFIG,
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});

describe('persistSchedulingConfig — projeto que não existe mais', () => {
  it('lança um erro legível em vez do P2025 cru do Prisma', async () => {
    const prisma = fakePrisma(null);
    const redis = fakeRedis(null);
    await expect(
      persistSchedulingConfig(prisma, redis, 'projeto-deletado', DEFAULT_SCHEDULING_CONFIG),
    ).rejects.toThrow(/Project not found/);
  });
});
