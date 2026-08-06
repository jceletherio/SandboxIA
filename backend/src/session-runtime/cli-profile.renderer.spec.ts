import {
  buildCommandLine,
  renderArgs,
  renderJson,
  shellQuote,
} from './cli-profile.renderer';

describe('renderArgs', () => {
  it('substitui placeholders', () => {
    expect(renderArgs(['-p', '{{prompt}}', '--model', '{{model}}'], { prompt: 'hi', model: 'sonnet' }))
      .toEqual(['-p', 'hi', '--model', 'sonnet']);
  });

  it('remove a flag anterior quando o placeholder não resolve', () => {
    expect(renderArgs(['--mcp-config', '{{mcpConfigPath}}', '--model', '{{model}}'], { model: 'x' }))
      .toEqual(['--model', 'x']);
  });

  it('remove arg posicional não resolvido sem afetar vizinhos posicionais', () => {
    expect(renderArgs(['run', '{{prompt}}', '--format', 'json'], {})).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });
});

describe('renderJson', () => {
  it('renderiza template aninhado', () => {
    const template = {
      mcpServers: {
        orchestrator: {
          url: '{{url}}',
          headers: { Authorization: 'Bearer {{token}}' },
        },
      },
    };
    expect(renderJson(template, { url: 'http://x/mcp', token: 'abc' })).toEqual({
      mcpServers: {
        orchestrator: {
          url: 'http://x/mcp',
          headers: { Authorization: 'Bearer abc' },
        },
      },
    });
  });
});

describe('shellQuote / buildCommandLine', () => {
  it('não quota tokens simples', () => {
    expect(shellQuote('--model', 'linux')).toBe('--model');
  });

  it('quota strings com espaços e aspas', () => {
    expect(shellQuote(`it's a test`, 'linux')).toBe(`'it'\\''s a test'`);
  });

  it('monta linha de comando', () => {
    expect(buildCommandLine('claude', ['--model', 'sonnet'], 'linux')).toBe('claude --model sonnet');
  });
});

/**
 * A linha montada aqui é COLADA num shell interativo, então um quote errado não
 * dá erro de compilação — dá boot de CLI quebrado com mensagem ilegível. As
 * duas famílias de shell escapam aspa simples de formas incompatíveis, e é isso
 * que estes testes prendem.
 */
describe('shellQuote por plataforma', () => {
  it('deixa passar sem aspas o que não precisa, nos dois shells', () => {
    for (const arg of ['claude', '--model', 'sonnet', 'a/b.json', 'k=v', '--permission-mode']) {
      expect(shellQuote(arg, 'linux')).toBe(arg);
      expect(shellQuote(arg, 'win32')).toBe(arg);
    }
  });

  it('POSIX escapa aspa simples fechando e reabrindo a string', () => {
    expect(shellQuote("O'Brien", 'linux')).toBe(`'O'\\''Brien'`);
  });

  it('PowerShell escapa aspa simples DOBRANDO, não com a regra POSIX', () => {
    expect(shellQuote("O'Brien", 'win32')).toBe("'O''Brien'");
    // A regra POSIX aqui viraria string + barra solta + string: o parse quebra.
    expect(shellQuote("O'Brien", 'win32')).not.toContain('\\');
  });

  it('caminho de Windows sobrevive: barra invertida não é escape dentro de aspas', () => {
    const path = 'C:\\Users\\Magno R\\.orchestrator\\mcp.json';
    expect(shellQuote(path, 'win32')).toBe(`'${path}'`);
  });
});

describe('buildCommandLine por plataforma', () => {
  it('monta a linha do perfil claude com o caminho de config entre aspas', () => {
    const line = buildCommandLine(
      'claude',
      ['--mcp-config', 'C:\\Users\\Magno R\\.orchestrator\\mcp.json', '--model', 'sonnet'],
      'win32',
    );
    expect(line).toBe(
      "claude --mcp-config 'C:\\Users\\Magno R\\.orchestrator\\mcp.json' --model sonnet",
    );
  });

  it('binário simples NÃO ganha o operador de chamada', () => {
    expect(buildCommandLine('claude', ['--model', 'sonnet'], 'win32')).not.toContain('&');
  });

  it('binário com espaço ganha `&` no Windows, senão a linha só ecoaria o caminho', () => {
    const line = buildCommandLine('C:\\Program Files\\cli\\claude.cmd', ['--model', 'sonnet'], 'win32');
    expect(line).toBe("& 'C:\\Program Files\\cli\\claude.cmd' --model sonnet");
  });

  it('no POSIX o `&` nunca aparece — ali ele mandaria o processo para background', () => {
    const line = buildCommandLine('/opt/my cli/claude', ['--model', 'sonnet'], 'linux');
    expect(line).toBe("'/opt/my cli/claude' --model sonnet");
    expect(line.startsWith('&')).toBe(false);
  });
});
