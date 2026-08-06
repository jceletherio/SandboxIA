/**
 * `isBareShellPrompt` é a checagem que evita colar prompt de chat num CLI que
 * já crashou e deixou só o shell do host no pane (ver comentário na função).
 */
import { isBareShellPrompt } from './pane.util';

describe('isBareShellPrompt', () => {
  it('detecta prompt do PowerShell como última linha', () => {
    const pane = [
      'algum output antigo do CLI',
      'PS C:\\Users\\Magno R\\Desktop\\Arquivos\\Projetos\\Pessoais\\task\\taskflow-pwa-mvp-a0b54c>',
    ].join('\n');
    expect(isBareShellPrompt(pane)).toBe(true);
  });

  it('detecta prompt do cmd.exe', () => {
    expect(isBareShellPrompt('C:\\Users\\Magno R>')).toBe(true);
  });

  it('detecta prompt bash user@host', () => {
    expect(isBareShellPrompt('magno@DESKTOP:~/projeto$')).toBe(true);
  });

  it('não confunde tela do CLI (TUI) com shell nu', () => {
    const pane = [
      '╭──────────────────────────────╮',
      '│ > digite sua mensagem aqui   │',
      '╰──────────────────────────────╯',
    ].join('\n');
    expect(isBareShellPrompt(pane)).toBe(false);
  });

  it('ignora prompt que não está na última linha (só scrollback)', () => {
    const pane = ['PS C:\\algum\\lugar>', 'saída do comando que rodou depois'].join('\n');
    expect(isBareShellPrompt(pane)).toBe(false);
  });
});
