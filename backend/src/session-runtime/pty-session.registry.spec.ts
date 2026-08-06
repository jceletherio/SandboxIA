import { PtySessionRegistry } from './pty-session.registry';

/**
 * Checagem do substituto do tmux. Roda contra um PTY de verdade (é o ponto:
 * ConPTY no Windows, PTY normal no resto), então cada teste espera a tela
 * estabilizar em vez de assumir tempo fixo.
 */
describe('PtySessionRegistry', () => {
  let registry: PtySessionRegistry;
  const name = 'test-pane';

  beforeEach(() => {
    registry = new PtySessionRegistry();
  });

  afterEach(() => {
    registry.killAll();
  });

  /** Espera até `predicate(capturePane())` ou estoura o prazo. */
  async function waitForPane(
    paneName: string,
    predicate: (pane: string) => boolean,
    timeoutMs = 20_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pane = registry.capturePane(paneName);
      if (predicate(pane)) return pane;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`pane never matched: ${JSON.stringify(registry.capturePane(paneName))}`);
  }

  it('cria o pane, e ele existe até ser morto', () => {
    expect(registry.exists(name)).toBe(false);
    registry.create(name, { cwd: process.cwd() });
    expect(registry.exists(name)).toBe(true);
    expect(registry.pid(name)).toBeGreaterThan(0);
    registry.kill(name);
    expect(registry.exists(name)).toBe(false);
  });

  it('create é idempotente — não troca o processo do pane', () => {
    registry.create(name, { cwd: process.cwd() });
    const pid = registry.pid(name);
    registry.create(name, { cwd: process.cwd() });
    expect(registry.pid(name)).toBe(pid);
  });

  it('capturePane devolve a tela renderizada, sem escapes ANSI', async () => {
    registry.create(name, { cwd: process.cwd() });
    registry.paste(name, 'echo MARCADOR_UNICO');
    registry.sendEnter(name);

    // Duas ocorrências: o eco do comando e a saída dele.
    const pane = await waitForPane(
      name,
      (p) => (p.match(/MARCADOR_UNICO/g) || []).length >= 2,
    );
    // É isto que o waitForPaneReady e a verificação de paste consomem: se
    // vazasse escape, toda comparação de tela quebraria.
    expect(pane).not.toMatch(/\x1b\[/);
  });

  it('serialize devolve o estado da tela COM escapes, para o redraw do attach', async () => {
    registry.create(name, { cwd: process.cwd() });
    registry.paste(name, 'echo REDRAW_ME');
    registry.sendEnter(name);
    await waitForPane(name, (p) => (p.match(/REDRAW_ME/g) || []).length >= 2);

    const snapshot = registry.serialize(name);
    expect(snapshot).toContain('REDRAW_ME');
    expect(snapshot).toMatch(/\x1b\[/);
  });

  it('attach faz fan-out para vários assinantes de UM processo', async () => {
    registry.create(name, { cwd: process.cwd() });
    const a: string[] = [];
    const b: string[] = [];
    const detachA = registry.attach(name, (d) => a.push(d), { replay: false });
    registry.attach(name, (d) => b.push(d), { replay: false });

    registry.paste(name, 'echo FANOUT');
    registry.sendEnter(name);
    await waitForPane(name, (p) => (p.match(/FANOUT/g) || []).length >= 2);

    expect(a.join('')).toContain('FANOUT');
    expect(b.join('')).toContain('FANOUT');

    // Desanexar um NÃO pode calar o outro nem matar o pane — é o caso de
    // fechar uma aba do /terminal com o agente rodando.
    detachA();
    const beforeA = a.length;
    registry.paste(name, 'echo DEPOIS');
    registry.sendEnter(name);
    await waitForPane(name, (p) => (p.match(/DEPOIS/g) || []).length >= 2);

    expect(a.length).toBe(beforeA);
    expect(b.join('')).toContain('DEPOIS');
    expect(registry.exists(name)).toBe(true);
  });

  it('attach com replay entrega o estado da tela antes do primeiro chunk novo', async () => {
    registry.create(name, { cwd: process.cwd() });
    registry.paste(name, 'echo JA_ACONTECEU');
    registry.sendEnter(name);
    await waitForPane(name, (p) => (p.match(/JA_ACONTECEU/g) || []).length >= 2);

    // Assinante que chega DEPOIS: sem replay abriria em tela branca.
    const late: string[] = [];
    registry.attach(name, (d) => late.push(d), { replay: true });
    expect(late.join('')).toContain('JA_ACONTECEU');
  });

  it('respawn troca o processo, preserva os assinantes e limpa a tela', async () => {
    registry.create(name, { cwd: process.cwd() });
    registry.paste(name, 'echo ANTES_DO_RESPAWN');
    registry.sendEnter(name);
    await waitForPane(name, (p) => (p.match(/ANTES_DO_RESPAWN/g) || []).length >= 2);

    const received: string[] = [];
    registry.attach(name, (d) => received.push(d), { replay: false });
    const pidAntes = registry.pid(name);

    registry.respawn(name);

    expect(registry.exists(name)).toBe(true);
    expect(registry.pid(name)).not.toBe(pidAntes);

    // O assinante seguiu para o pane novo: a aba anexada continua anexada.
    registry.paste(name, 'echo DEPOIS_DO_RESPAWN');
    registry.sendEnter(name);
    await waitForPane(name, (p) => (p.match(/DEPOIS_DO_RESPAWN/g) || []).length >= 2);
    expect(received.join('')).toContain('DEPOIS_DO_RESPAWN');

    // A corrida que o guard do onExit evita: o onExit do PTY velho chega
    // DEPOIS do create do novo e não pode apagar a entrada recém-criada.
    await new Promise((r) => setTimeout(r, 1_000));
    expect(registry.exists(name)).toBe(true);
  });

  it('respawn preserva o env do pane original', async () => {
    registry.create(name, { cwd: process.cwd(), env: { ORCHESTRATOR_SESSION_ID: 'abc123' } });
    registry.respawn(name);

    const readVar =
      process.platform === 'win32'
        ? 'echo $env:ORCHESTRATOR_SESSION_ID'
        : 'echo $ORCHESTRATOR_SESSION_ID';
    registry.paste(name, readVar);
    registry.sendEnter(name);

    // Duas ocorrências do valor = eco do comando não conta (no Windows o eco
    // mostra a variável, não o valor), então basta o valor aparecer.
    const pane = await waitForPane(name, (p) => p.includes('abc123'));
    expect(pane).toContain('abc123');
  });

  it('lastActivity avança quando o pane escreve, e é null para pane inexistente', async () => {
    expect(registry.lastActivity('nao-existe')).toBeNull();

    registry.create(name, { cwd: process.cwd() });
    await waitForPane(name, (p) => p.trim().length > 0);
    const antes = registry.lastActivity(name)!;

    await new Promise((r) => setTimeout(r, 1_100));
    registry.paste(name, 'echo ATIVIDADE');
    registry.sendEnter(name);
    await waitForPane(name, (p) => (p.match(/ATIVIDADE/g) || []).length >= 2);

    expect(registry.lastActivity(name)!).toBeGreaterThan(antes);
  });

  it('write em pane inexistente lança em vez de virar no-op silencioso', () => {
    expect(() => registry.write('nao-existe', 'oi')).toThrow(/not running/);
  });

  it('killAll derruba todos os panes', () => {
    registry.create('pane-a', { cwd: process.cwd() });
    registry.create('pane-b', { cwd: process.cwd() });
    expect(registry.listNames()).toHaveLength(2);
    registry.killAll();
    expect(registry.listNames()).toHaveLength(0);
  });
});
