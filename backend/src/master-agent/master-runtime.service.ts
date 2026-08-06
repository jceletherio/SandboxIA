import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  RenderContext,
  buildCommandLine,
  renderArgs,
  renderJson,
} from '../session-runtime/cli-profile.renderer';
import {
  capturePane,
  createPane,
  isBareShellPrompt,
  killPane,
  paneExists,
  sendPromptToPane,
} from '../session-runtime/pane.util';

/**
 * Prefixo das tmux do Master. Até a MT-20 este era o nome INTEIRO e único —
 * um Master para o backend todo. Agora cada projeto tem a sua
 * (`masterTmuxSession`), que é o que permite dois projetos com automação
 * disparando ao mesmo tempo sem um roubar o terminal do outro.
 */
export const MASTER_TMUX_PREFIX = 'orchestr-master';

/**
 * `id.slice(0, 8)` pelo mesmo motivo do `workDir`: nome de sessão tmux não
 * aceita `.` e `:` e fica ilegível com um uuid inteiro. 8 hex já não colide na
 * ordem de grandeza de projetos que uma máquina hospeda.
 */
export function masterTmuxSession(projectId: string): string {
  return `${MASTER_TMUX_PREFIX}-${projectId.slice(0, 8)}`;
}

interface ProjectLike {
  id: string;
  name: string;
  mainPath: string;
}

interface ProfileLike {
  id: string;
  name: string;
  binary: string;
  interactiveArgs: unknown;
  mcpConfigFile: string;
  mcpConfigTemplate: unknown;
  env: unknown;
  defaultModel: string | null;
}

/**
 * Runtime do Master Agent: uma sessão tmux interativa PERSISTENTE rodando o
 * CLI do usuário, com config MCP própria (token master). Triagem e chat são
 * prompts colados neste terminal; as respostas voltam via MCP tools
 * (answer_question / escalate_question / reply_chat) — sem parse de stdout e
 * sem timeout de one-shot.
 *
 * O workdir é dedicado (~/.orchestr/master/<proj>) para conter edições do CLI
 * fora do repositório principal do usuário.
 *
 * MT-20: uma tmux POR PROJETO. Todo método recebe `projectId` — o serviço não
 * guarda estado, quem sabe quais projetos estão ativos é o `MasterAgentService`.
 */
@Injectable()
export class MasterRuntimeService {
  private readonly logger = new Logger(MasterRuntimeService.name);

  private get mcpUrl(): string {
    const base =
      process.env.ORCHESTRATOR_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`;
    return `${base.replace(/\/$/, '')}/mcp`;
  }

  /**
   * `model` sobrescreve `profile.defaultModel` — é como o Master roda num
   * modelo diferente do das sessões (`project.settings.defaults.masterModel`,
   * resolvido pelo `MasterAgentService` antes de chamar `start`).
   *
   * `permissionMode` alimenta `{{permissionMode}}` dos `interactiveArgs`, do
   * mesmo jeito que no runtime das sessões. Sem ele o `renderArgs` descarta o
   * `--permission-mode` inteiro (placeholder não resolvido derruba a flag
   * anterior) e o CLI do Master subia no modo de permissão default, pedindo
   * confirmação a cada tool call — num terminal que ninguém está olhando, o
   * Master simplesmente travava esperando um "yes".
   */
  async start(
    project: ProjectLike,
    profile: ProfileLike,
    token: string,
    model?: string,
    permissionMode?: string,
  ): Promise<{ tmuxSession: string; workDir: string }> {
    const workDir = path.join(os.homedir(), '.orchestr', 'master', project.id.slice(0, 8));
    await fs.mkdir(workDir, { recursive: true });
    const tmuxSession = masterTmuxSession(project.id);

    const ctx: RenderContext = {
      model: model || profile.defaultModel || undefined,
      url: this.mcpUrl,
      token,
      permissionMode,
    };

    const mcpConfigPath = path.join(workDir, profile.mcpConfigFile);
    await fs.mkdir(path.dirname(mcpConfigPath), { recursive: true });
    await fs.writeFile(
      mcpConfigPath,
      JSON.stringify(renderJson(profile.mcpConfigTemplate, ctx), null, 2),
    );
    ctx.mcpConfigPath = mcpConfigPath;

    if (!(await paneExists(tmuxSession))) {
      const env: Record<string, string> = {
        ORCHESTRATOR_URL: this.mcpUrl,
        ORCHESTRATOR_ROLE: 'master',
        ORCHESTRATOR_PROJECT: project.name,
        ...((profile.env as Record<string, string> | null) || {}),
      };
      await createPane(tmuxSession, { cwd: workDir, env, cols: 220, rows: 50 });

      // Lança o CLI interativo dentro do pane
      const args = renderArgs(profile.interactiveArgs as string[], ctx);
      await sendPromptToPane(tmuxSession, buildCommandLine(profile.binary, args));
      this.logger.log(
        `Master Agent terminal started: ${profile.binary} in tmux ${tmuxSession} at ${workDir}`,
      );
    } else {
      this.logger.log(`Master Agent tmux ${tmuxSession} already running — reusing`);
    }

    return { tmuxSession, workDir };
  }

  async isRunning(projectId: string): Promise<boolean> {
    return paneExists(masterTmuxSession(projectId));
  }

  /** Cola um prompt no terminal do Master daquele projeto (multiline-safe) + Enter. */
  async sendPrompt(projectId: string, text: string): Promise<void> {
    const tmuxSession = masterTmuxSession(projectId);
    if (!(await paneExists(tmuxSession))) {
      throw new Error('Master Agent terminal is not running — activate the Master Agent first');
    }
    // CLI do Master pode ter crashado deixando só o shell do host no pane —
    // colar aqui faria o shell EXECUTAR o texto como comando (ver
    // `isBareShellPrompt`).
    if (isBareShellPrompt(await capturePane(tmuxSession))) {
      throw new Error(
        `Master Agent CLI appears to have exited — tmux ${tmuxSession} shows a bare shell prompt, refusing to paste a prompt into it`,
      );
    }
    await sendPromptToPane(tmuxSession, text);
  }

  /**
   * Reseta o contexto do Master (MT-27): mata a tmux e sobe outra do zero, com
   * o MESMO token — o mcp config já está escrito no workdir e o CLI novo o
   * relê no boot, então a conexão MCP continua válida. `start` sozinho não
   * serve: ele reusa a sessão tmux existente, que é justamente a conversa
   * gigante que se quer jogar fora.
   */
  async recycle(
    project: ProjectLike,
    profile: ProfileLike,
    token: string,
    model?: string,
    permissionMode?: string,
  ): Promise<void> {
    await this.stop(project.id);
    await this.start(project, profile, token, model, permissionMode);
    this.logger.log(
      `Master Agent terminal recycled (tmux ${masterTmuxSession(project.id)} recreated)`,
    );
  }

  async stop(projectId: string): Promise<void> {
    const tmuxSession = masterTmuxSession(projectId);
    if (await paneExists(tmuxSession)) {
      try {
        await killPane(tmuxSession);
      } catch (error) {
        this.logger.warn(`Failed to kill master pane ${tmuxSession}: ${error.message}`);
      }
    }
  }
}
