import { detectApprovalDialog, isBareShellPrompt } from './pane.util';

/**
 * As telas abaixo são CAPTURAS REAIS das sessões de teste — cada uma travou uma
 * rodada do fluxo SDD por até 27 minutos, com a sessão reportando `running` e
 * `paneAlive: true` o tempo todo. O detector existe para que esse silêncio vire
 * uma mensagem dizendo o que está sendo pedido.
 */

const confiancaEmPasta = `
  Claude Code'll be able to read, edit, and execute files here.
  Security guide
  Do you trust this folder?
  ❯ 1. Yes, I trust this folder
    2. No, exit
  Enter to confirm · Esc to cancel
`;

const aprovacaoDeComando = `
 Bash command
   find . -maxdepth 4 -type d | grep -v "^\\.\\/\\.git"
   List directory tree excluding .git
 This command requires approval
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for: grep -v "^\\.\\/\\.git"
   3. No
 Esc to cancel · Tab to amend · ctrl+e to explain
`;

const leituraForaDoProjeto = `
 Read file
  Read(C:\\Users\\Magno R\\.claude\\skills\\sdd\\references\\doc-structure.md)
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, allow reading from references/ during this session
   3. No
 Esc to cancel · Tab to amend
`;

const avisoDeBypass = `
  WARNING: Claude Code running in Bypass Permissions mode
  In Bypass Permissions mode, Claude Code will not ask for your approval.
  By proceeding, you accept all responsibility for actions taken.
  ❯ 1. No, exit
    2. Yes, I accept
  Enter to confirm · Esc to cancel
`;

const trabalhando = `
● Skill(sdd)
  ⎿  Successfully loaded skill
● Searching for 1 pattern, reading 1 file, calling orchestrator…
  ⎿  README.md
✻ thinking with high effort
`;

const shellNu = 'PS C:\\Users\\Magno R\\Projetos\\app>';

describe('detectApprovalDialog', () => {
  it('reconhece o diálogo de confiança em pasta nova', () => {
    const d = detectApprovalDialog(confiancaEmPasta)!;
    expect(d).not.toBeNull();
    expect(d.question).toMatch(/trust this folder/i);
    expect(d.options).toEqual(['Yes, I trust this folder', 'No, exit']);
  });

  it('reconhece aprovação de comando e captura QUAL comando', () => {
    const d = detectApprovalDialog(aprovacaoDeComando)!;
    expect(d).not.toBeNull();
    // O COMANDO no subject é o que faltava na mensagem que chegava ao usuário —
    // sem ele, "parou em alguma etapa" não diz onde olhar.
    expect(d.subject).toContain('find . -maxdepth 4');
    expect(d.options).toHaveLength(3);
  });

  it('reconhece pedido de leitura fora do projeto', () => {
    const d = detectApprovalDialog(leituraForaDoProjeto)!;
    expect(d).not.toBeNull();
    expect(d.options[1]).toMatch(/allow reading/i);
  });

  it('reconhece o aviso de bypass, cuja opção destacada é SAIR', () => {
    const d = detectApprovalDialog(avisoDeBypass)!;
    expect(d).not.toBeNull();
    // É por isto que responder "1" cegamente não serve como política geral:
    // aqui a primeira opção encerra o CLI.
    expect(d.options[0]).toMatch(/No, exit/i);
  });

  it('pane trabalhando NÃO é diálogo — falso positivo pararia sessão saudável', () => {
    expect(detectApprovalDialog(trabalhando)).toBeNull();
  });

  it('shell nu não é diálogo (é o outro detector)', () => {
    expect(detectApprovalDialog(shellNu)).toBeNull();
    expect(isBareShellPrompt(shellNu)).toBe(true);
  });

  it('frase solta sem opções numeradas não conta como menu', () => {
    const texto = 'O log diz: this command requires approval em algum momento.';
    expect(detectApprovalDialog(texto)).toBeNull();
  });

  it('menu antigo no scrollback não dispara — só a cauda da tela é olhada', () => {
    const antigo = aprovacaoDeComando + '\n' + Array(30).fill('saída nova do agente').join('\n');
    expect(detectApprovalDialog(antigo)).toBeNull();
  });
});
