import { findDuplicate, hasSharedFile, isDuplicateFinding, normalizeTitle } from './backlog-dedupe';

describe('normalizeTitle', () => {
  it('ignora acento, case e pontuação', () => {
    expect(normalizeTitle('Validação NÃO checa tipo!')).toBe('validacao nao checa tipo');
  });
});

describe('hasSharedFile', () => {
  it('casa caminhos iguais e caminhos que só diferem no prefixo', () => {
    expect(hasSharedFile(['backend/src/a.ts'], ['./backend/src/a.ts'])).toBe(true);
    expect(hasSharedFile(['backend/src/master-agent.service.ts'], ['master-agent.service.ts'])).toBe(true);
  });

  it('lista vazia nunca casa', () => {
    expect(hasSharedFile([], ['a.ts'])).toBe(false);
    expect(hasSharedFile(['a.ts'], ['b.ts'])).toBe(false);
  });
});

describe('isDuplicateFinding', () => {
  it('funde título idêntico a menos de acento/case', () => {
    expect(
      isDuplicateFinding(
        { title: 'master-agent.service.ts é grande demais', files: [] },
        { title: 'MASTER-AGENT.SERVICE.TS e grande demais', files: [] },
      ),
    ).toBe(true);
  });

  it('funde títulos parecidos quando há arquivo em comum', () => {
    expect(
      isDuplicateFinding(
        { title: 'master-agent.service.ts está grande demais', files: ['backend/src/master-agent/master-agent.service.ts'] },
        { title: 'master-agent.service.ts grande demais, precisa quebrar', files: ['backend/src/master-agent/master-agent.service.ts'] },
      ),
    ).toBe(true);
  });

  it('não funde findings diferentes que citam o mesmo arquivo', () => {
    expect(
      isDuplicateFinding(
        { title: 'resolver ignora timeout negativo', files: ['backend/src/config/resolve-runtime-config.ts'] },
        { title: 'provenance não cobre listas', files: ['backend/src/config/resolve-runtime-config.ts'] },
      ),
    ).toBe(false);
  });

  it('funde título contido no outro mesmo sem arquivo em comum', () => {
    // O título longo não deve ser punido por ser longo: é a mesma observação.
    expect(
      isDuplicateFinding(
        { title: 'pipeline engine grande demais', files: ['a.ts'] },
        { title: 'pipeline engine muito grande demais', files: ['b.ts'] },
      ),
    ).toBe(true);
  });

  it('sem arquivo em comum e sem tokens em comum, não funde', () => {
    expect(
      isDuplicateFinding(
        { title: 'merge queue não serializa rebase', files: ['a.ts'] },
        { title: 'catálogo de modelos duplica provider', files: ['b.ts'] },
      ),
    ).toBe(false);
  });

  // Os dois casos abaixo saíram dos 4 reports reais da Onda 0/1 e definem o teto
  // da heurística: eles empatam em sobreposição de título quando medidos por
  // Jaccard, e só o par de baixo pode fundir.
  it('funde o par real do provisionamento de node_modules', () => {
    expect(
      isDuplicateFinding(
        {
          title:
            'Provisionamento de node_modules por symlink no worktree quebra next build (Turbopack) — mitigado manualmente, não no código',
          files: ['backend/src/workspace/workspace.service.ts'],
        },
        {
          title: '01-CONTRATOS §7 prescreve symlink de node_modules, que quebra o build do frontend',
          files: ['docs/melhorias/01-CONTRATOS.md'],
        },
      ),
    ).toBe(true);
  });

  it('NÃO funde dois bugs diferentes do mesmo session-runtime.service.ts', () => {
    expect(
      isDuplicateFinding(
        {
          title: 'session-runtime.service.ts:945 (rebootCli) hardcoda permission-mode',
          files: ['backend/src/session-runtime/session-runtime.service.ts'],
        },
        {
          title: 'session-runtime.service.ts ainda lê o pipeline ao vivo',
          files: ['backend/src/session-runtime/session-runtime.service.ts'],
        },
      ),
    ).toBe(false);
  });

  it('título vazio não deduplica contra nada', () => {
    expect(isDuplicateFinding({ title: '  ', files: [] }, { title: '  ', files: [] })).toBe(false);
  });
});

describe('findDuplicate', () => {
  it('devolve o primeiro candidato duplicado, ou undefined', () => {
    const existing = [
      { id: '1', title: 'outra coisa', files: [] },
      { id: '2', title: 'resolver ignora timeout negativo', files: ['x.ts'] },
    ];
    expect(findDuplicate({ title: 'Resolver ignora timeout negativo', files: [] }, existing)?.id).toBe('2');
    expect(findDuplicate({ title: 'nada a ver com isso aqui', files: [] }, existing)).toBeUndefined();
  });
});
