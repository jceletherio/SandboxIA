import { ptyRegistry } from './pty-session.registry';

/**
 * Helpers de pane compartilhados (session-runtime e master-runtime).
 *
 * Substitui o antigo `tmux.util.ts`: as mesmas operações, agora contra o
 * `PtySessionRegistry` em vez do binário `tmux`. As assinaturas continuam
 * assíncronas mesmo o registry sendo síncrono — os call sites já fazem `await`
 * e mudar isso seria churn sem ganho, além de deixar a porta aberta para o
 * registry virar processo destacado (aí volta a ser I/O de verdade).
 */

export interface CreatePaneOptions {
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

/** Cria o pane detached (antigo `tmux new-session -d`). No-op se já existe. */
export async function createPane(name: string, opts: CreatePaneOptions): Promise<void> {
  ptyRegistry.create(name, opts);
}

export async function paneExists(name: string): Promise<boolean> {
  return ptyRegistry.exists(name);
}

/** Tela visível em texto puro (antigo `capture-pane -p`). */
export async function capturePane(name: string): Promise<string> {
  return ptyRegistry.capturePane(name);
}

export async function killPane(name: string): Promise<void> {
  ptyRegistry.kill(name);
}

/**
 * Cola texto no pane em bracketed paste — nada é interpretado durante o envio,
 * e CLIs TUI reconhecem multi-linha como UMA colagem em vez de uma sequência
 * de Enters. Era o par `load-buffer` + `paste-buffer -p` do tmux.
 */
export async function pastePane(name: string, text: string): Promise<void> {
  ptyRegistry.paste(name, text);
}

/** Cola um prompt e envia Enter separado (CLIs em bracketed-paste). */
export async function sendPromptToPane(name: string, text: string): Promise<void> {
  await pastePane(name, text);
  // O CLI precisa fechar o bloco de paste antes do Enter, senão o Enter entra
  // DENTRO da colagem e vira quebra de linha em vez de submissão.
  await new Promise((resolve) => setTimeout(resolve, 300));
  ptyRegistry.sendEnter(name);
}

/**
 * Última linha não vazia do pane é um prompt de shell do HOST (PowerShell,
 * cmd, bash) em vez do CLI do agente — sinal de que o CLI morreu e o pane só
 * tem o processo do shell por baixo dele sobrando.
 *
 * Existe porque `pastePane`/`sendPromptToPane` colam via bracketed paste
 * (`\x1b[200~...\x1b[201~`), que só o CLI TUI interpreta como colagem opaca.
 * Um shell puro não reconhece a sequência: devolve o texto ao terminal linha a
 * linha e o Enter final executa cada uma como comando — foi assim que uma
 * resposta de watchdog ("Answer to your question...") virou
 * `CommandNotFoundException` num PowerShell que já tinha perdido o CLI.
 * Quem chama precisa checar isto ANTES de colar num pane que deveria ter um
 * CLI vivo — não se aplica ao boot do CLI, que cola a própria linha de
 * comando exatamente num shell nu.
 */
const SHELL_PROMPT_PATTERN = /^(PS [A-Za-z]:\\.*>|[A-Za-z]:\\.*>|[\w.-]+@[\w.-]+:.*[$#])\s*$/;

export function isBareShellPrompt(pane: string): boolean {
  const lines = pane.replace(/\s+$/, '').split('\n');
  const last = (lines[lines.length - 1] || '').trim();
  return SHELL_PROMPT_PATTERN.test(last);
}

/** Diálogo de aprovação detectado na tela do pane. */
export interface ApprovalDialog {
  /** A pergunta ("Do you want to proceed?", "Do you trust this folder?"). */
  question: string;
  /** As opções numeradas, na ordem em que aparecem. */
  options: string[];
  /** O que está sendo pedido — a linha de comando/arquivo acima da pergunta. */
  subject: string;
}

const DIALOG_QUESTION =
  /(Do you want to proceed\?|Do you trust this folder\?|requires approval|running in Bypass Permissions mode)/i;
const DIALOG_OPTION = /^[❯>]?\s*(\d)\.\s+(.*\S)\s*$/;
/** Quantas linhas antes da pergunta entram no `subject`. */
const SUBJECT_LINES = 3;

/**
 * Reconhece o menu de aprovação que o CLI abre e fica esperando resposta.
 *
 * Existe porque o pane parado num menu é INDISTINGUÍVEL de um pane trabalhando,
 * do ponto de vista do orquestrador: `paneAlive` continua true, o processo
 * segue vivo e a tela simplesmente para de mudar. O `isPaneIdle` lê isso como
 * "sessão em silêncio" e o watchdog responde colando um prompt de
 * destravamento — que cai DENTRO do menu, onde o Enter escolhe a opção
 * destacada em vez de responder o que se queria.
 *
 * Sete rodadas de teste travaram assim, cada uma num diálogo diferente
 * (confiança em pasta, aprovação de comando, leitura fora do projeto), e o
 * único jeito de descobrir qual era foi reconstruir a tela à mão. Detectar aqui
 * transforma "parou em alguma etapa" em "parou pedindo X".
 */
export function detectApprovalDialog(pane: string): ApprovalDialog | null {
  const linhas = pane.replace(/\s+$/, '').split('\n').map((l) => l.trim());

  // A pergunta fica perto do fim; olhar a tela inteira acharia menu já
  // respondido que continua no scrollback.
  const cauda = linhas.slice(-18);
  const iPergunta = cauda.findIndex((l) => DIALOG_QUESTION.test(l));
  if (iPergunta === -1) return null;

  const options: string[] = [];
  for (const linha of cauda.slice(iPergunta + 1)) {
    const m = DIALOG_OPTION.exec(linha);
    if (m) options.push(m[2]);
  }
  // Sem opções numeradas não é menu — pode ser a frase solta num texto.
  if (options.length < 2) return null;

  // Algumas linhas antes da pergunta, não só a última: o CLI põe a descrição
  // logo acima da pergunta e o COMANDO acima dela, e é o comando que responde
  // "parado pedindo o quê".
  const subject = cauda
    .slice(0, iPergunta)
    .filter((l) => l.length > 0)
    .slice(-SUBJECT_LINES)
    .join(' | ');

  return { question: cauda[iPergunta], options, subject };
}
