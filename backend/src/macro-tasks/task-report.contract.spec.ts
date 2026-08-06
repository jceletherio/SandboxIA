import { parseTaskReport } from './task-report.contract';

describe('parseTaskReport', () => {
  it('lê o formato do contrato §6', () => {
    const raw = JSON.stringify({
      macroTaskId: 'mt-1',
      sessionId: 's-1',
      summary: 'fez o que pediram',
      findings: [
        {
          kind: 'bug',
          title: 'validate não checa tipo de tags',
          detail: 'array de número passa',
          files: ['backend/src/pipelines/pipeline-definition.ts'],
          effort: 's',
          priority: 2,
        },
      ],
    });
    const result = parseTaskReport(raw);
    expect(result.errors).toEqual([]);
    expect(result.report?.macroTaskId).toBe('mt-1');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].effort).toBe('s');
  });

  it('não lança e não perde o resto quando o JSON é inválido', () => {
    const result = parseTaskReport('{ isso não é json ');
    expect(result.report).toBeNull();
    expect(result.findings).toEqual([]);
    expect(result.errors).toContain('JSON não parseável.');
  });

  it('trata vazio, null e undefined como report ausente', () => {
    for (const raw of ['', '   ', null, undefined]) {
      const result = parseTaskReport(raw);
      expect(result.report).toBeNull();
      expect(result.errors).toEqual(['Report vazio ou ausente.']);
    }
  });

  it('remove a cerca de markdown que o CLI adiciona', () => {
    const raw = '```json\n{"findings":[{"title":"x","kind":"bug","effort":"s"}]}\n```';
    expect(parseTaskReport(raw).findings).toHaveLength(1);
  });

  it('recupera JSON com prosa em volta e sinaliza o desvio', () => {
    const raw = 'Aqui está o report:\n{"findings":[{"title":"x"}]}\nEspero que sirva.';
    const result = parseTaskReport(raw);
    expect(result.findings).toHaveLength(1);
    expect(result.errors).toContain('JSON recuperado por recorte — havia texto fora do objeto.');
  });

  it('aceita array cru como lista de findings sem envelope', () => {
    const result = parseTaskReport('[{"title":"x","kind":"debt"}]');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe('debt');
  });

  it('descarta finding sem title mas mantém os irmãos válidos', () => {
    const raw = JSON.stringify({ findings: [{ kind: 'bug' }, { title: 'vale' }] });
    const result = parseTaskReport(raw);
    expect(result.findings.map((f) => f.title)).toEqual(['vale']);
    expect(result.errors).toContain('finding[0]: sem "title" — descartado.');
  });

  it('cai no default quando kind ou effort saem do enum, sem descartar o finding', () => {
    const raw = JSON.stringify({
      findings: [{ title: 'x', kind: 'refactor', effort: 'xl' }],
    });
    const result = parseTaskReport(raw);
    expect(result.findings[0].kind).toBe('improvement');
    expect(result.findings[0].effort).toBe('m');
    expect(result.errors).toHaveLength(2);
  });

  it('normaliza files como string única e clampa priority', () => {
    const raw = JSON.stringify({
      findings: [{ title: 'x', files: 'a/b.ts', priority: '99' }],
    });
    const result = parseTaskReport(raw);
    expect(result.findings[0].files).toEqual(['a/b.ts']);
    expect(result.findings[0].priority).toBe(2);
  });

  it('reporta findings ausente e findings vazio de formas distintas', () => {
    expect(parseTaskReport('{"summary":"nada"}').errors).toContain('Report sem "findings".');
    // `findings: []` NÃO é desvio: é o report de uma sessão que não achou nada.
    expect(parseTaskReport('{"findings":[]}').errors).toEqual([]);
  });

  /**
   * O `outcome` existe porque `findings.length === 0` juntava dois desfechos
   * opostos: "parseou e não tinha nada" e "não deu para ler". O segundo precisa de
   * olho humano, o primeiro é sucesso — e era o primeiro que gerava item de dívida
   * falso no backlog (MT-24).
   */
  describe('outcome', () => {
    it('"ok" quando sobrou finding aproveitável', () => {
      expect(parseTaskReport('{"findings":[{"title":"x"}]}').outcome).toBe('ok');
    });

    it('"empty" para findings vazio e para findings ausente — resultado válido', () => {
      expect(parseTaskReport('{"findings":[]}').outcome).toBe('empty');
      expect(parseTaskReport('{"summary":"nada a reportar"}').outcome).toBe('empty');
      expect(parseTaskReport('[]').outcome).toBe('empty');
    });

    it('"unparseable" quando não há JSON legível', () => {
      expect(parseTaskReport('{ isso não é json ').outcome).toBe('unparseable');
      expect(parseTaskReport('').outcome).toBe('unparseable');
      expect(parseTaskReport('"só uma string"').outcome).toBe('unparseable');
    });

    it('"unparseable" quando declarou findings e nenhum sobreviveu', () => {
      // Aqui houve PERDA de informação: o agente reportou algo e o texto não
      // chegou. Fechar em silêncio esconderia exatamente o que precisa de humano.
      const result = parseTaskReport('{"findings":[{"kind":"bug"},"isso não é objeto"]}');
      expect(result.findings).toEqual([]);
      expect(result.outcome).toBe('unparseable');
    });

    it('"unparseable" quando "findings" não é array', () => {
      expect(parseTaskReport('{"findings":"nenhum"}').outcome).toBe('unparseable');
    });
  });

  describe('evidence', () => {
    it('lê a lista de provas e aceita string única', () => {
      const raw = JSON.stringify({
        findings: [
          { title: 'a', evidence: ['backlog-ingest.service.ts:158', 'pnpm test rodado'] },
          { title: 'b', evidence: 'contract.ts:205' },
        ],
      });
      const result = parseTaskReport(raw);
      expect(result.findings[0].evidence).toEqual([
        'backlog-ingest.service.ts:158',
        'pnpm test rodado',
      ]);
      expect(result.findings[1].evidence).toEqual(['contract.ts:205']);
      expect(result.errors).toContain('finding[1]: "evidence" não é array — tratado como lista de 1.');
    });

    it('finding sem evidência continua válido e sem campo — ausência é sinal, não erro', () => {
      const result = parseTaskReport('{"findings":[{"title":"x","kind":"bug","evidence":[]}]}');
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].evidence).toBeUndefined();
      expect(result.errors).toEqual([]);
    });
  });
});
