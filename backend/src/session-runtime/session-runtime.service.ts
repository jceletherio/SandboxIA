import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  forwardRef,
} from '@nestjs/common';
import type { CliProfile, LLMModel, PhaseModelAssignment } from '@prisma/client';
import { execFile, spawn } from 'child_process';
import { createHash } from 'crypto';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ptyRegistry } from './pty-session.registry';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { CHANNELS, GitChangedEvent } from '../redis/channels';
import {
  RenderContext,
  buildCommandLine,
  renderArgs,
  renderJson,
} from './cli-profile.renderer';
import { OutputBuffer } from './output-buffer';
import { createPane, killPane, isBareShellPrompt, detectApprovalDialog } from './pane.util';
import {
  PipelineDefinition,
  normalizePipelineDefinition,
} from '../pipelines/pipeline-definition';
import { PipelineEngineService } from '../pipeline-engine/pipeline-engine.service';
import {
  ResolvedConfig,
  describeProvenance,
  normalizeProjectDefaults,
  projectDefaultsToConfigLayer,
  resolveRuntimeConfig,
} from '../config';

const execFileAsync = promisify(execFile);

/**
 * Campos opcionais do contrato de pipeline (podem ainda não existir em
 * pipeline-definition.ts — outro agente os adiciona; tipagem defensiva aqui).
 */
type ExtendedPipelineDefinition = PipelineDefinition & {
  permissions?: string[];
  extraMcpServers?: Record<string, unknown>;
};


interface RuntimeHandle {
  /**
   * Desassina o stream do pane. Antes aqui morava o `pty.IPty` do
   * `tmux attach-session`: um processo cliente por sessão, e matá-lo desanexava
   * sem tocar no CLI. Agora o pane é o próprio processo no `ptyRegistry` e o
   * handle é só a assinatura — desanexar é chamar isto, matar o CLI é
   * `killPane`. Os dois já eram passos distintos no `stop()`.
   */
  detach: () => void;
  tmuxSession: string;
  buffer: OutputBuffer;
  lastOutputAt: Date;
  /**
   * `false` até o pane receber o primeiro byte. Existe porque o attach semeia
   * `lastOutputAt` com a hora do attach: sem esta flag, reanexar a um pane
   * parado há uma hora faria a sessão parecer viva agora e o stall check
   * voltaria a ficar cego (MT-11).
   */
  sawOutput: boolean;
}

/**
 * De onde veio o sinal de vida da sessão. `tmux` e `log` sobrevivem ao restart
 * do backend; `pty` só vale com handle vivo que já recebeu output.
 */
type ActivitySource = 'pty' | 'tmux' | 'log' | 'none';

/** Último sinal de vida da sessão e sua origem. */
interface SessionActivity {
  at: Date | null;
  source: ActivitySource;
}

/** Estado do vínculo backend ↔ CLI, consumido pela API e pelo MCP. */
export interface SessionLiveness {
  hasPty: boolean;
  tmuxAlive: boolean;
  lastOutputAt: string | null;
  linkLost: boolean;
  lastActivityAt: string | null;
  activitySource: ActivitySource;
  tmuxSession: string;
}

/**
 * Estado do watchdog em `session.stageData._watchdog`. Vive no `stageData`
 * (Json) pela mesma razão do `_runtime`: não exige coluna nova. Precisa
 * sobreviver ao restart do backend — é o que impede o reprompt de recomeçar do
 * zero a cada rebuild e ficar empurrando a sessão para sempre.
 */
interface WatchdogState {
  repromptCount: number;
  lastRepromptAt: string;
  /** Stage em que os reprompts foram gastos; stage novo zera a contagem. */
  stage: string | null;
  /**
   * Hash das últimas linhas do pane na rodada anterior do check. É a base de
   * comparação do `isPaneIdle`: tela idêntica entre duas rodadas = ninguém
   * está escrevendo ali. Vazio na primeira rodada de um stage.
   */
  paneHash: string;
}

/**
 * Glifos de spinner e vocabulário de progresso dos CLIs. Era o único sinal de
 * "trabalhando" até a MT-23 e é fraco por natureza — saída de teste com a
 * palavra "running" num pane parado era lida como CLI ativo e o reprompt nunca
 * disparava. Sobrou como desempate da primeira rodada do check num stage,
 * quando ainda não existe captura anterior para comparar (ver `isPaneIdle`).
 */
const PANE_BUSY_PATTERN =
  /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✻✽✢·]|\b(esc to interrupt|tokens|thinking|running)\b/i;

/** Origem do par (CliProfile, model) efetivamente usado para subir o CLI. */
type RuntimeSource = 'phase-assignment' | 'agent';

/** Forma mínima de Session que a resolução de runtime precisa. */
interface SessionForRuntime {
  id: string;
  agentId: string;
  agent?: { model?: string | null; cliProfile?: CliProfile | null } | null;
}

/**
 * O que o Master mandou no `start_macro_task`, gravado em
 * `session.context.runtimeOverride` (contratos §5). É a camada mais forte do
 * resolver; `stages[nome]` refina só aquele stage.
 */
export interface SessionRuntimeOverride {
  model?: string;
  cliProfile?: string;
  permissionMode?: string;
  subagents?: string[];
  skills?: string[];
  stages?: Record<string, Omit<SessionRuntimeOverride, 'stages'>>;
}

/** Forma mínima de Session para montar todas as camadas do resolver (§3). */
interface SessionForStageRuntime extends SessionForRuntime {
  context?: unknown;
  macroTask?: {
    project?: { settings?: unknown } | null;
    pipeline?: { stages: unknown } | null;
  } | null;
}

/** Runtime efetivo de um stage: config resolvida + de onde veio cada campo. */
export interface StageRuntime {
  profile: CliProfile;
  config: ResolvedConfig;
  /** `describeProvenance()` em uma linha, para o log da sessão. */
  provenance: string;
  source: RuntimeSource;
  assignmentId?: string;
  warnings: string[];
}

/** `PhaseModelAssignment` com as relações que a resolução precisa. */
type PhaseAssignmentWithRelations = PhaseModelAssignment & {
  model: LLMModel | null;
  cliProfile: CliProfile | null;
};

/**
 * Registro do que foi usado no último boot do CLI, gravado em
 * `session.stageData._runtime`. É o que permite detectar, na troca de stage,
 * que o CLI vivo não bate mais com o runtime pedido pela fase nova.
 * Vive no `stageData` (Json) de propósito: não exige coluna nova no schema.
 */
interface RuntimeStamp {
  cliProfileId: string;
  cliProfileName: string;
  model: string | null;
  /**
   * Rendido nos args do CLI, então entra na comparação de reinício.
   * `undefined` = stamp gravado antes da MT-4, que não registrava o campo — aí
   * não dá para afirmar que mudou, e reiniciar por suposição custaria o
   * contexto vivo do CLI.
   */
  permissionMode?: string | null;
  /** Só informativos: vão para o prompt do stage, não para os args do CLI. */
  skills: string[];
  subagents: string[];
  phase: string | null;
  source: RuntimeSource;
  assignmentId?: string;
  /** `describeProvenance()` do boot — de onde veio cada valor (§3). */
  provenance?: string;
  bootedAt: string;
}

@Injectable()
export class SessionRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionRuntimeService.name);
  private readonly handles = new Map<string, RuntimeHandle>();
  private stallCheckInterval: NodeJS.Timeout | null = null;
  private readonly stallTimeoutMs = parseInt(process.env.STALL_TIMEOUT_MINUTES || '10', 10) * 60_000;
  private readonly stallCheckIntervalMs = parseInt(process.env.STALL_CHECK_INTERVAL_MINUTES || '5', 10) * 60_000;
  /** Quantos reprompts de "feche o stage" antes de escalar para `Question`. */
  private readonly stallMaxReprompts = parseInt(process.env.STALL_MAX_REPROMPTS || '2', 10);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private workspace: WorkspaceService,
    // Ciclo real de módulos (o engine injeta este serviço): `forwardRef` dos
    // dois lados. `@Optional()` porque os testes unitários instanciam o serviço
    // direto, sem container — quem depende dele tem fallback.
    @Optional()
    @Inject(forwardRef(() => PipelineEngineService))
    private pipelineEngine?: PipelineEngineService,
  ) {}

  async onModuleInit() {
    this.stallCheckInterval = setInterval(() => {
      void this.checkStalledSessions();
    }, this.stallCheckIntervalMs);
    await this.recoverOrphanedSessions();
  }

  private async recoverOrphanedSessions() {
    const runningSessions = await this.prisma.session.findMany({
      where: { status: { in: ['running', 'waiting', 'initializing'] } },
      select: { id: true, tmuxSession: true, worktreePath: true },
    });

    for (const session of runningSessions) {
      // Isolado por sessão: isto roda no `onModuleInit` e agora dá `pty.spawn`.
      // Uma sessão problemática derrubando o bootstrap seria reproduzir o
      // próprio incidente que esta task existe para evitar.
      try {
        await this.recoverOneSession(session);
      } catch (error) {
        this.logger.warn(`Failed to recover session ${session.id} on startup: ${error.message}`);
      }
    }
  }

  private async recoverOneSession(session: {
    id: string;
    tmuxSession: string | null;
    worktreePath: string;
  }) {
    if (this.handles.has(session.id)) return;

    if (session.tmuxSession && (await this.tmuxSessionExists(session.tmuxSession))) {
      // O processo do backend reinicia com frequência (o projeto editado É o
      // orquestrador) e `handles` é Map em memória: nasce vazio. Antes daqui
      // ninguém reanexava — o CLI seguia vivo no tmux e a sessão ficava sem
      // `lastOutputAt`, sem `write()` e invisível para o stall check.
      // `stalledAt` NÃO é limpo: reganhar o vínculo não é prova de que o agente
      // voltou a trabalhar, e quem decide isso é o stall check.
      const reattached = await this.reattachToLiveTmux(
        session.id,
        session.tmuxSession,
        session.worktreePath,
      );
      if (reattached) {
        this.logger.log(
          `Session ${session.id} reattached on startup (tmux ${session.tmuxSession} was alive)`,
        );
      }
      return;
    }

    this.logger.warn(`Session ${session.id} is orphaned (no runtime, no tmux) — marking as stalled`);
    await this.prisma.session.update({
      where: { id: session.id },
      data: { stalledAt: new Date() },
    });
    await this.redis.publish(CHANNELS.SESSION_STALLED, {
      sessionId: session.id,
      stalledAt: new Date().toISOString(),
      reason: 'orphaned_on_startup',
    });
  }

  /**
   * Reanexa o PTY a um tmux que sobreviveu ao processo do backend e regrava o
   * `pid`. Idempotente por construção: `attachPty` desiste se já existe handle,
   * então rodar duas vezes não duplica PTY nem processo. Compartilhado pelo boot
   * (`recoverOrphanedSessions`) e pelo resume manual (`resumeSession`) — só o
   * resume manual limpa `stalledAt`, porque ali existe intenção humana de
   * declarar a sessão saudável.
   */
  private async reattachToLiveTmux(
    sessionId: string,
    tmuxSession: string,
    cwd: string,
    opts?: { clearStalled?: boolean },
  ): Promise<boolean> {
    const alreadyAttached = this.handles.has(sessionId);
    if (!alreadyAttached) this.attachPty(sessionId, tmuxSession, cwd);
    const handle = this.handles.get(sessionId);
    if (!handle) return false;
    // Handle já existente também atualiza `stalledAt` quando pedido: o resume
    // manual precisa desmarcar a sessão mesmo que o PTY nunca tenha caído.
    if (!alreadyAttached || opts?.clearStalled) {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: {
          pid: ptyRegistry.pid(handle.tmuxSession) ?? null,
          ...(opts?.clearStalled ? { stalledAt: null } : {}),
        },
      });
    }
    return !alreadyAttached;
  }

  private get mcpUrl(): string {
    const base =
      process.env.ORCHESTRATOR_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`;
    return `${base.replace(/\/$/, '')}/mcp`;
  }

  private tmuxName(sessionId: string): string {
    return `orchestr-${sessionId.slice(0, 8)}`;
  }

  private async tmuxSessionExists(name: string): Promise<boolean> {
    return ptyRegistry.exists(name);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Tela visível do pane em texto puro — o antigo `capture-pane -p`. Vem do
   * espelho `@xterm/headless` do registry, que resolve os escapes ANSI; ler o
   * stream cru aqui não funcionaria, porque CLI em TUI reescreve linha o tempo
   * todo e duas leituras consecutivas nunca ficariam iguais (é exatamente a
   * comparação em que o `waitForPaneReady` se apoia).
   */
  private async capturePane(tmuxSession: string): Promise<string> {
    return ptyRegistry.capturePane(tmuxSession);
  }

  /**
   * Polling ativo até o pane estar "pronto": conteúdo não-vazio E estável
   * (duas capturas consecutivas idênticas). Nada de timeout fixo cego —
   * retorna assim que estabilizar; em timeout loga warn e devolve a última
   * captura (best effort, quem chama decide o que fazer).
   */
  private async waitForPaneReady(
    tmuxSession: string,
    opts?: { timeoutMs?: number; pollMs?: number },
  ): Promise<string> {
    const timeoutMs = opts?.timeoutMs ?? 90_000;
    const pollMs = opts?.pollMs ?? 500;
    const deadline = Date.now() + timeoutMs;
    let previous: string | null = null;

    while (Date.now() < deadline) {
      const current = await this.capturePane(tmuxSession);
      if (current.trim().length > 0 && previous !== null && current === previous) {
        return current;
      }
      previous = current;
      await this.sleep(pollMs);
    }
    this.logger.warn(
      `waitForPaneReady: pane of tmux ${tmuxSession} did not stabilize within ${timeoutMs}ms — proceeding anyway`,
    );
    return previous ?? '';
  }

  /**
   * Cola texto no pane e submete com Enter VERIFICADO: captura o pane antes
   * do Enter; se após ~1.5s nada mudou (Enter não registrou/CLI engoliu),
   * reenvia Enter — até 3 tentativas. Falha ruidosa: warn + LogEntry + throw.
   */
  private async pasteAndSubmit(
    tmuxSession: string,
    text: string,
    sessionId: string,
    label: string,
  ): Promise<void> {
    // Trecho verificável do texto: primeira linha não-vazia, curta o bastante
    // para não sofrer quebra de linha no pane (largura 200).
    const snippet = (text.split('\n').find((l) => l.trim()) || '').trim().slice(0, 60);

    // CLIs TUI (Claude Code) colapsam colagens multi-linha num placeholder
    // "[Pasted text #N +X lines]" — o texto literal nunca aparece no pane.
    // A colagem também conta como recebida quando surge um placeholder NOVO
    // (contagem maior que antes do paste); sem isso a verificação falhava
    // sempre e o prompt era colado em triplicata.
    const countPasteMarkers = (pane: string) =>
      (pane.match(/\[Pasted text #\d+/g) || []).length;

    // 1) Cola e VERIFICA que o texto chegou ao input do CLI antes do Enter.
    // "Pane mudou" não basta: o CLI pode ter engolido o paste durante o boot
    // e a mudança de tela ser só ele terminando de desenhar a UI.
    const pasteAttempts = 3;
    let pasted = false;
    for (let attempt = 1; attempt <= pasteAttempts && !pasted; attempt++) {
      const markersBefore = countPasteMarkers(await this.capturePane(tmuxSession));
      await this.pasteToTmux(tmuxSession, text);
      await this.sleep(400);
      if (!snippet) {
        pasted = true;
        break;
      }
      for (let poll = 0; poll < 8; poll++) {
        const pane = await this.capturePane(tmuxSession);
        if (pane.includes(snippet) || countPasteMarkers(pane) > markersBefore) {
          pasted = true;
          break;
        }
        await this.sleep(500);
      }
      if (!pasted && attempt < pasteAttempts) {
        this.logger.warn(
          `Session ${sessionId}: ${label} paste not visible in tmux ${tmuxSession} (attempt ${attempt}/${pasteAttempts}) — waiting for pane and re-pasting`,
        );
        await this.waitForPaneReady(tmuxSession, { timeoutMs: 20_000 });
      }
    }
    if (!pasted) {
      this.logger.warn(
        `Session ${sessionId}: ${label} paste never became visible in tmux ${tmuxSession} — sending Enter anyway as last resort`,
      );
    }

    // 2) Enter com verificação de mudança de tela.
    const before = await this.capturePane(tmuxSession);
    const maxAttempts = 3;
    ptyRegistry.sendEnter(tmuxSession);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.sleep(1500);
      const after = await this.capturePane(tmuxSession);
      if (after !== before) return; // pane mudou → submissão registrada
      if (attempt < maxAttempts) {
        this.logger.warn(
          `Session ${sessionId}: ${label} not submitted in tmux ${tmuxSession} (pane unchanged, attempt ${attempt}/${maxAttempts}) — re-sending Enter`,
        );
        ptyRegistry.sendEnter(tmuxSession);
      }
    }

    const message = `Failed to submit ${label} in tmux ${tmuxSession}: pane unchanged after ${maxAttempts} Enter attempts`;
    this.logger.warn(`Session ${sessionId}: ${message}`);
    try {
      await this.prisma.logEntry.create({
        data: {
          sessionId,
          level: 'warn',
          message,
          metadata: { kind: 'submit-verification', label, tmuxSession },
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to persist submit-verification log for ${sessionId}: ${error.message}`);
    }
    throw new Error(message);
  }

  // ------------------------------------------ runtime por stage (P2.2 + MT-4)

  /**
   * Base do agente: o par (profile, model) mais fraco de todos, usado como
   * camada `env` do resolver. `agent.model === 'default'` significa "o que o
   * profile mandar".
   */
  private agentBaseline(session: SessionForRuntime): { profile: CliProfile; model?: string } {
    const profile = session.agent?.cliProfile;
    if (!profile) {
      throw new Error(
        `Agent ${session.agentId} has no CLI profile assigned — assign a CliProfile before starting the session`,
      );
    }
    const model =
      session.agent?.model && session.agent.model !== 'default'
        ? session.agent.model
        : profile.defaultModel || undefined;
    return { profile, model };
  }

  /**
   * O que o `PhaseModelAssignment` da fase tem a dizer, isolado das outras
   * camadas — a MT-4 precisa dele separado para posicioná-lo na precedência do
   * resolver (contratos §3) em vez de já achatado sobre o agente.
   * Retorna `{}` quando não há assignment aplicável; nunca lança.
   */
  private async resolvePhaseAssignment(
    phase: string | null,
    agentProfile: CliProfile,
    agentModel: string | undefined,
    warnings: string[],
  ): Promise<{ profile?: CliProfile; model?: string; assignmentId?: string }> {
    const wanted = phase?.trim();
    if (!wanted) return {};

    let assignment: PhaseAssignmentWithRelations | null = null;
    try {
      assignment = await this.findPhaseAssignment(wanted, warnings);
    } catch (error) {
      warnings.push(
        `Failed to look up PhaseModelAssignment for phase "${wanted}": ${error.message} — using the agent's profile/model`,
      );
      return {};
    }
    if (!assignment) return {};

    const result: { profile?: CliProfile; model?: string; assignmentId?: string } = {
      assignmentId: assignment.id,
    };

    if (assignment.cliProfileId) {
      if (assignment.cliProfile) {
        result.profile = assignment.cliProfile;
      } else {
        warnings.push(
          `Phase assignment ${assignment.id} (phase "${assignment.phase}") points to CliProfile ${assignment.cliProfileId}, which no longer exists — keeping the agent's profile "${agentProfile.name}"`,
        );
      }
    }

    if (!assignment.model) {
      warnings.push(
        `Phase assignment ${assignment.id} (phase "${assignment.phase}") points to LLMModel ${assignment.modelId}, which no longer exists — keeping the agent's model "${agentModel ?? 'none'}"`,
      );
    } else if (!assignment.model.enabled) {
      warnings.push(
        `Phase assignment ${assignment.id} (phase "${assignment.phase}") points to model "${assignment.model.name}", which is disabled — keeping the agent's model "${agentModel ?? 'none'}"`,
      );
    } else {
      result.model = assignment.model.name;
    }

    return result;
  }

  /**
   * Runtime efetivo de um stage: **ponto único** que monta as cinco camadas do
   * resolver (contratos §3) e devolve a config já resolvida, o `CliProfile`
   * correspondente e a proveniência pronta para o log. O engine usa o mesmo
   * resultado para o prompt (skills/subagentes) e este serviço para subir o CLI
   * — a precedência não é reimplementada em dois lugares.
   *
   * Camadas, do mais fraco para o mais forte:
   * - `env`: config do Agent (profile + `agent.model`/`defaultModel`);
   * - `projectDefaults`: `project.settings.defaults` (§4);
   * - `pipelineDefaults`: `pipeline.defaults` + `permissionMode` (§2);
   * - `stage`: `PhaseModelAssignment` da fase, coberto pelos campos do próprio
   *   `PipelineStage` — o stage é específico daquele pipeline e o assignment é
   *   global por nome de fase, então o stage ganha dentro da camada;
   * - `sessionOverride`: `context.runtimeOverride` + `.stages[fase]`.
   *
   * Nunca lança por causa de camada podre — só pela ausência de `CliProfile` no
   * agente, que já era erro antes. Cada degradação vira `warning`.
   */
  async resolveStageRuntime(
    session: SessionForStageRuntime,
    phase: string | null,
  ): Promise<StageRuntime> {
    const warnings: string[] = [];
    const { profile: agentProfile, model: agentModel } = this.agentBaseline(session);
    const assignment = await this.resolvePhaseAssignment(
      phase,
      agentProfile,
      agentModel,
      warnings,
    );

    const pipeline = this.loadPipelineFor(session, warnings);
    const stageDef = phase
      ? pipeline?.stages.find((s) => s.name === phase)
      : undefined;
    const override = this.readRuntimeOverride(session.context);
    const { stages: stageOverrides, ...sessionScalars } = override ?? {};

    const resolution = resolveRuntimeConfig({
      env: { model: agentModel, cliProfile: agentProfile.name },
      projectDefaults: projectDefaultsToConfigLayer(
        normalizeProjectDefaults(session.macroTask?.project?.settings),
      ),
      pipelineDefaults: pipeline
        ? { ...pipeline.defaults, permissionMode: pipeline.permissionMode }
        : undefined,
      stage: {
        ...(assignment.model ? { model: assignment.model } : {}),
        ...(assignment.profile ? { cliProfile: assignment.profile.name } : {}),
        ...stageDef,
      },
      sessionOverride: {
        ...sessionScalars,
        ...(phase ? stageOverrides?.[phase] : undefined),
      },
    });

    const profile = await this.resolveProfileByName(
      resolution.config.cliProfile,
      agentProfile,
      assignment.profile,
      warnings,
    );
    const applied = !!(assignment.profile || assignment.model);

    return {
      profile,
      config: resolution.config,
      provenance: describeProvenance(resolution),
      source: applied ? 'phase-assignment' : 'agent',
      ...(applied && assignment.assignmentId ? { assignmentId: assignment.assignmentId } : {}),
      warnings,
    };
  }

  /**
   * Filtra skills/subagentes pelo que existe de fato no worktree (ou na pasta
   * do usuário, de onde o CLI também carrega). Prompt que manda usar um
   * subagente inexistente faz o agente inventar um — pior que não citar nada.
   *
   * Skills são PASTAS (`.claude/skills/<nome>/`), subagentes são arquivos
   * (`.claude/agents/<nome>.md`) — mesma convenção do `cli-files`.
   */
  async filterAvailableCliFiles(
    worktreePath: string | null,
    wanted: { skills: string[]; subagents: string[] },
  ): Promise<{ skills: string[]; subagents: string[]; missing: string[] }> {
    const roots = [worktreePath, os.homedir()].filter((r): r is string => !!r);
    const exists = async (relative: string) => {
      for (const root of roots) {
        try {
          await fs.access(path.join(root, relative));
          return true;
        } catch {
          // procura no próximo root
        }
      }
      return false;
    };

    const missing: string[] = [];
    const keep = async (names: string[], relative: (name: string) => string, kind: string) => {
      const found: string[] = [];
      for (const name of names) {
        if (await exists(relative(name))) found.push(name);
        else missing.push(`${kind} "${name}"`);
      }
      return found;
    };

    return {
      skills: await keep(wanted.skills, (n) => path.join('.claude', 'skills', n), 'skill'),
      subagents: await keep(
        wanted.subagents,
        (n) => path.join('.claude', 'agents', `${n}.md`),
        'subagent',
      ),
      missing,
    };
  }

  /** `session.context.runtimeOverride` com validação defensiva (Json não tipado). */
  private readRuntimeOverride(context: unknown): SessionRuntimeOverride | null {
    if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
    const raw = (context as Record<string, unknown>).runtimeOverride;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as SessionRuntimeOverride;
  }

  /**
   * Pipeline efetivo da sessão pelo snapshot (§5). Tolerante: sem engine
   * injetado (testes) ou sem pipeline carregado, devolve `null` e as camadas
   * `pipelineDefaults`/`stage` simplesmente não existem.
   */
  private loadPipelineFor(
    session: SessionForStageRuntime,
    warnings: string[],
  ): PipelineDefinition | null {
    if (!session.macroTask?.pipeline) return null;
    if (!this.pipelineEngine) {
      // Só acontece se o forwardRef do módulo quebrar: sem o engine as camadas
      // `pipelineDefaults` e `stage` somem em silêncio e o model do stage deixa
      // de valer. Barulhento de propósito.
      warnings.push(
        'Pipeline engine not injected — pipeline defaults and stage runtime fields were ignored',
      );
      return null;
    }
    try {
      return this.pipelineEngine.loadSessionPipeline({
        id: session.id,
        context: session.context,
        macroTask: { pipeline: session.macroTask.pipeline },
      });
    } catch (error) {
      warnings.push(`Failed to load the session pipeline: ${error.message} — ignoring its runtime layers`);
      return null;
    }
  }

  /**
   * Nome do `CliProfile` resolvido → registro. Os dois candidatos já em mãos
   * (agente e assignment) evitam ida ao banco no caso comum; nome que não
   * existe cai no profile do agente com warning, em vez de derrubar o boot.
   */
  private async resolveProfileByName(
    name: string | undefined,
    agentProfile: CliProfile,
    assignmentProfile: CliProfile | undefined,
    warnings: string[],
  ): Promise<CliProfile> {
    if (!name || name === agentProfile.name) return agentProfile;
    if (assignmentProfile && name === assignmentProfile.name) return assignmentProfile;
    try {
      const found = await this.prisma.cliProfile.findFirst({
        where: { OR: [{ id: name }, { name }] },
      });
      if (found) return found;
    } catch (error) {
      warnings.push(
        `Failed to look up CLI profile "${name}": ${error.message} — keeping the agent's profile "${agentProfile.name}"`,
      );
      return agentProfile;
    }
    warnings.push(
      `CLI profile "${name}" does not exist — keeping the agent's profile "${agentProfile.name}"`,
    );
    return agentProfile;
  }

  /**
   * Busca o assignment da fase: match exato e, como fallback,
   * case-insensitive (`Merge` casa com `merge`). `findFirst` + `updatedAt desc`
   * porque `phase` não é `@unique` no schema — `findUnique` é impossível aqui.
   */
  private async findPhaseAssignment(
    phase: string,
    warnings: string[],
  ): Promise<PhaseAssignmentWithRelations | null> {
    const include = { model: true, cliProfile: true } as const;
    const orderBy = { updatedAt: 'desc' } as const;

    const exact = await this.prisma.phaseModelAssignment.findFirst({
      where: { phase },
      include,
      orderBy,
    });
    if (exact) return exact;

    const loose = await this.prisma.phaseModelAssignment.findFirst({
      where: { phase: { equals: phase, mode: 'insensitive' } },
      include,
      orderBy,
    });
    if (loose) {
      warnings.push(
        `Phase "${phase}" had no exact PhaseModelAssignment; matched assignment ${loose.id} case-insensitively (stored phase: "${loose.phase}")`,
      );
    }
    return loose;
  }

  /** Warnings de resolução → logger + `LogEntry` na sessão (evidência do CA3). */
  private async logRuntimeWarnings(
    sessionId: string,
    warnings: string[],
    phase: string | null,
  ): Promise<void> {
    if (warnings.length === 0) return;
    for (const warning of warnings) {
      this.logger.warn(`Session ${sessionId}: ${warning}`);
    }
    try {
      await this.prisma.logEntry.create({
        data: {
          sessionId,
          level: 'warn',
          message: warnings.join(' | '),
          metadata: { kind: 'phase-model-assignment', phase, warnings },
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist phase-model-assignment warning for ${sessionId}: ${error.message}`,
      );
    }
  }

  /** `LogEntry` informativo dizendo qual profile/model subiu e de onde veio (CA1). */
  private async logRuntimeBoot(
    sessionId: string,
    stamp: RuntimeStamp,
    action: 'boot' | 'restart' | 'phase-switch',
    detail?: string,
  ): Promise<void> {
    const origin =
      stamp.source === 'phase-assignment'
        ? `phase assignment ${stamp.assignmentId} for phase "${stamp.phase}"`
        : 'agent configuration';
    // A proveniência (§3) é o que torna a precedência depurável: diz de qual
    // camada saiu cada valor, não só qual valor ganhou.
    const provenance = stamp.provenance ? ` [${stamp.provenance}]` : '';
    const message = `CLI ${action}: profile "${stamp.cliProfileName}" model "${stamp.model ?? 'default'}" (from ${origin})${provenance}${detail ? ` — ${detail}` : ''}`;
    this.logger.log(`Session ${sessionId}: ${message}`);
    try {
      await this.prisma.logEntry.create({
        data: {
          sessionId,
          level: 'info',
          message,
          metadata: { kind: 'runtime-profile', action, ...stamp },
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to persist runtime-profile log for ${sessionId}: ${error.message}`);
    }
  }

  /** Lê `stageData._runtime` com validação defensiva (Json não tipado). */
  private readRuntimeStamp(stageData: unknown): RuntimeStamp | null {
    if (!stageData || typeof stageData !== 'object' || Array.isArray(stageData)) return null;
    const raw = (stageData as Record<string, unknown>)._runtime;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const stamp = raw as Partial<RuntimeStamp>;
    if (typeof stamp.cliProfileId !== 'string') return null;
    const list = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    return {
      cliProfileId: stamp.cliProfileId,
      cliProfileName: typeof stamp.cliProfileName === 'string' ? stamp.cliProfileName : '?',
      model: typeof stamp.model === 'string' ? stamp.model : null,
      // ausente ≠ null: ver o comentário do campo em `RuntimeStamp`
      ...('permissionMode' in stamp
        ? { permissionMode: typeof stamp.permissionMode === 'string' ? stamp.permissionMode : null }
        : {}),
      skills: list(stamp.skills),
      subagents: list(stamp.subagents),
      phase: typeof stamp.phase === 'string' ? stamp.phase : null,
      source: stamp.source === 'phase-assignment' ? 'phase-assignment' : 'agent',
      ...(typeof stamp.assignmentId === 'string' ? { assignmentId: stamp.assignmentId } : {}),
      ...(typeof stamp.provenance === 'string' ? { provenance: stamp.provenance } : {}),
      bootedAt: typeof stamp.bootedAt === 'string' ? stamp.bootedAt : new Date(0).toISOString(),
    };
  }

  /**
   * Grava `stageData._runtime` com merge **atômico** no banco (`jsonb ||`), não
   * com read-modify-write. Mesma razão do `writeWatchdogState`: o boot do CLI
   * (findUnique → update) não é instantâneo, e se o agente chamar
   * `complete_stage` nesse intervalo, um read-modify-write regravaria o
   * `stageData` a partir de uma leitura desatualizada — apagando o
   * `stageData[stage].completedAt` que acabou de ser gravado e deixando o
   * pipeline parado esperando um sinal que já foi dado. Nunca lança (é
   * metadado, não pode derrubar boot nem stage).
   */
  private async stampRuntime(
    sessionId: string,
    resolved: StageRuntime,
    phase: string | null,
  ): Promise<RuntimeStamp> {
    const stamp: RuntimeStamp = {
      cliProfileId: resolved.profile.id,
      cliProfileName: resolved.profile.name,
      model: resolved.config.model ?? null,
      permissionMode: resolved.config.permissionMode ?? null,
      skills: resolved.config.skills,
      subagents: resolved.config.subagents,
      phase: phase ?? null,
      source: resolved.source,
      ...(resolved.assignmentId ? { assignmentId: resolved.assignmentId } : {}),
      provenance: resolved.provenance,
      bootedAt: new Date().toISOString(),
    };
    try {
      await this.prisma.$executeRaw`
        UPDATE sessions
        SET stage_data = COALESCE(stage_data, '{}'::jsonb) || ${JSON.stringify({ _runtime: stamp })}::jsonb
        WHERE id = ${sessionId}
      `;
    } catch (error) {
      this.logger.warn(`Failed to stamp runtime metadata for ${sessionId}: ${error.message}`);
    }
    return stamp;
  }

  /**
   * Aplica o runtime resolvido da fase nova (§3: override da sessão > stage >
   * defaults do pipeline > defaults do projeto > assignment/agente) ao CLI já
   * em execução.
   *
   * Chamado pelo `pipeline-engine` no dispatch de cada stage interativo. O
   * processo do CLI sobe **uma vez por sessão** (`startSession`), com a flag
   * `--model` já fixada nos `interactiveArgs`; logo, para uma atribuição de fase
   * valer de fato, o CLI precisa ser **rebootado** com os args novos. É o que
   * este método faz quando (e só quando) o runtime pedido pela fase difere do
   * que está rodando.
   *
   * Só `model`, `cliProfile` e `permissionMode` disparam reinício: são os que
   * viram args do processo. `skills`/`subagents` mudam apenas o prompt do stage,
   * então reiniciar por causa deles seria perder o contexto vivo do CLI à toa.
   *
   * Reiniciar o CLI no meio do pipeline é aceitável por design: o prompt de cada
   * stage é autocontido — `pipeline-engine.buildStagePrompt()` re-injeta o
   * resumo dos stages já concluídos a partir de `session.stageData`, além do
   * bloco de retomada. O trabalho anterior está no worktree/commits, não na
   * memória do processo do CLI.
   *
   * Nunca lança: qualquer falha vira warn + `{ restarted: false, reason: 'error: …' }`.
   */
  async applyPhaseRuntime(
    sessionId: string,
    phase: string,
  ): Promise<{ restarted: boolean; reason: string }> {
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          agent: { include: { cliProfile: true } },
          macroTask: { include: { project: true, pipeline: true } },
        },
      });
      if (!session) return { restarted: false, reason: 'session-not-found' };

      const resolved = await this.resolveStageRuntime(session, phase);
      await this.logRuntimeWarnings(sessionId, resolved.warnings, phase);

      // Sem stamp (sessão iniciada antes desta feature) o CLI subiu, por
      // definição do comportamento antigo, com o profile/model do agente —
      // então a base do agente é um baseline confiável.
      const stamped = this.readRuntimeStamp(session.stageData);
      let baseline: RuntimeStamp;
      if (stamped) {
        baseline = stamped;
      } else {
        const base = await this.resolveStageRuntime(session, null);
        baseline = {
          cliProfileId: base.profile.id,
          cliProfileName: base.profile.name,
          model: base.config.model ?? null,
          permissionMode: base.config.permissionMode ?? null,
          skills: base.config.skills,
          subagents: base.config.subagents,
          phase: null,
          source: 'agent',
          bootedAt: new Date(0).toISOString(),
        };
      }

      const sameProfile = baseline.cliProfileId === resolved.profile.id;
      const sameModel = baseline.model === (resolved.config.model ?? null);
      const samePermissionMode =
        baseline.permissionMode === undefined ||
        baseline.permissionMode === (resolved.config.permissionMode ?? null);
      if (sameProfile && sameModel && samePermissionMode) {
        return { restarted: false, reason: 'unchanged' };
      }

      const changes: string[] = [];
      if (!sameProfile) {
        changes.push(`profile "${baseline.cliProfileName}" → "${resolved.profile.name}"`);
      }
      if (!sameModel) {
        changes.push(`model "${baseline.model ?? 'default'}" → "${resolved.config.model ?? 'default'}"`);
      }
      if (!samePermissionMode) {
        changes.push(
          `permissionMode "${baseline.permissionMode ?? 'default'}" → "${resolved.config.permissionMode ?? 'default'}"`,
        );
      }
      const reason = `${changes.join(', ')} (${resolved.provenance}${
        stamped ? '' : '; baseline assumed from agent config'
      })`;

      if (!this.isRunning(sessionId)) {
        // CLI não está vivo: não força reboot aqui (quem retomar a sessão
        // resolve de novo pela fase corrente). Só registra o esperado.
        await this.stampRuntime(sessionId, resolved, phase);
        return { restarted: false, reason: `cli-not-running; recorded expected runtime — ${reason}` };
      }

      this.logger.log(
        `Session ${sessionId}: restarting CLI for phase "${phase}" — ${reason}`,
      );
      await this.rebootCli(session, resolved, phase, 'phase-switch', reason);
      return { restarted: true, reason };
    } catch (error) {
      this.logger.warn(
        `applyPhaseRuntime failed for ${sessionId}/${phase}: ${error.message}`,
      );
      return { restarted: false, reason: `error: ${error.message}` };
    }
  }

  async startSession(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        agent: { include: { cliProfile: true } },
        macroTask: { include: { project: true, pipeline: true } },
      },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    // Precedência completa do contrato §3 — ver `resolveStageRuntime`.
    const phase = session.currentStage || null;
    const resolved = await this.resolveStageRuntime(session, phase);
    await this.logRuntimeWarnings(sessionId, resolved.warnings, phase);
    const profile = resolved.profile;
    const project = session.macroTask.project;

    let pipelineDef: ExtendedPipelineDefinition | null = null;
    try {
      if (session.macroTask.pipeline) {
        // Snapshot congelado da sessão (contratos §5), não o pipeline ao vivo:
        // editar o pipeline com a sessão rodando não muda mais o boot.
        pipelineDef = (
          this.pipelineEngine
            ? this.pipelineEngine.loadSessionPipeline(session)
            : normalizePipelineDefinition(session.macroTask.pipeline.stages)
        ) as ExtendedPipelineDefinition;
      }
    } catch (error) {
      this.logger.warn(`Session ${sessionId}: failed to normalize pipeline definition: ${error.message}`);
    }

    const worktreePath = await this.workspace.createWorktree(
      project.mainPath,
      session.branchName,
      project.worktreeBase,
    );
    await this.publishGitChanged({
      projectId: project.id,
      reason: 'worktree-created',
      ts: new Date().toISOString(),
      sessionId,
      branch: session.branchName,
    });

    const ctx: RenderContext = {
      model: resolved.config.model,
      url: this.mcpUrl,
      token: session.mcpToken,
      sessionId: session.id,
      // Já resolvido pela precedência (§3) — inclui o `permissionMode` do
      // pipeline, que antes era lido direto daqui.
      permissionMode: resolved.config.permissionMode || 'acceptEdits',
    };
    const mcpConfigPath = path.join(worktreePath, profile.mcpConfigFile);
    await fs.mkdir(path.dirname(mcpConfigPath), { recursive: true });
    const mcpConfig = renderJson(profile.mcpConfigTemplate, ctx) as Record<string, unknown>;
    // Merge aditivo dos MCPs extras do pipeline (ex.: Figma) no mesmo arquivo —
    // necessário com --strict-mcp-config. Entradas do pipeline NÃO sobrescrevem
    // as do perfil (em particular 'orchestrator').
    const extraMcpServers = pipelineDef?.extraMcpServers;
    if (extraMcpServers && typeof extraMcpServers === 'object') {
      const servers =
        mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object'
          ? (mcpConfig.mcpServers as Record<string, unknown>)
          : {};
      for (const [name, config] of Object.entries(extraMcpServers)) {
        if (name in servers) {
          this.logger.warn(
            `Session ${sessionId}: pipeline extraMcpServers entry "${name}" ignored (would override profile entry)`,
          );
          continue;
        }
        servers[name] = config;
      }
      mcpConfig.mcpServers = servers;
    }
    await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
    ctx.mcpConfigPath = mcpConfigPath;

    // Copia configs não-versionadas (.mcp.json, .claude/**) do repo principal e
    // semeia a allowlist de permissões: todos os servidores MCP visíveis no
    // worktree (config da sessão + .mcp.json) são pré-aprovados, mais os
    // defaults do projeto (settings.defaultPermissions) e os do pipeline.
    // Nunca pode derrubar o start da sessão.
    try {
      const serverNames = await this.collectMcpServerNames(
        worktreePath,
        project.mainPath,
        mcpConfig,
      );
      const projectSettings = (project.settings as any) || {};
      const defaultPermissions: string[] = Array.isArray(projectSettings.defaultPermissions)
        ? projectSettings.defaultPermissions.filter((p: unknown) => typeof p === 'string')
        : [];
      const permissions = [
        ...serverNames.flatMap((n) => [`mcp__${n}`, `mcp__${n}__*`]),
        ...defaultPermissions,
        ...(pipelineDef?.permissions ?? []),
      ];
      const { copiedFiles } = await this.workspace.seedWorktreeConfig({
        worktreePath,
        mainRepoPath: project.mainPath,
        permissions,
      });
      await this.prisma.logEntry.create({
        data: {
          sessionId,
          level: 'info',
          message: `Seeded worktree config: ${copiedFiles.length} file(s) copied, ${serverNames.length} MCP server(s) pre-approved (${serverNames.join(', ') || 'none'})`,
          metadata: { kind: 'seed-worktree-config', copiedFiles, mcpServers: serverNames, permissions },
        },
      });
    } catch (error) {
      this.logger.warn(`Session ${sessionId}: seedWorktreeConfig failed: ${error.message}`);
    }

    const tmuxSession = this.tmuxName(sessionId);
    if (!(await this.tmuxSessionExists(tmuxSession))) {
      const env = this.buildPaneEnv(session.id, session.mcpToken, profile.env, ctx);
      await createPane(tmuxSession, { cwd: worktreePath, env, cols: 200, rows: 50 });
    }

    this.attachPty(sessionId, tmuxSession, worktreePath);

    const interactiveArgs = renderArgs(profile.interactiveArgs as string[], ctx);
    const commandLine = buildCommandLine(profile.binary, interactiveArgs);
    // Espera o shell do pane estar pronto e submete o boot do CLI com verificação.
    await this.waitForPaneReady(tmuxSession, { timeoutMs: 15_000 });
    await this.pasteAndSubmit(tmuxSession, commandLine, sessionId, 'CLI boot command');

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        worktreePath,
        tmuxSession,
        pid: ptyRegistry.pid(tmuxSession) ?? null,
        status: 'running',
        stalledAt: null,
      },
    });
    const stamp = await this.stampRuntime(sessionId, resolved, phase);
    await this.logRuntimeBoot(sessionId, stamp, 'boot');
    await this.redis.publish(CHANNELS.SESSION_STATUS, { sessionId, status: 'running' });
    this.logger.log(
      `Session ${sessionId} started: ${profile.binary} in tmux ${tmuxSession} at ${worktreePath}`,
    );
  }

  private buildPaneEnv(
    sessionId: string,
    token: string,
    profileEnv: unknown,
    ctx: RenderContext,
  ): Record<string, string> {
    const env: Record<string, string> = {
      ORCHESTRATOR_SESSION_ID: sessionId,
      ORCHESTRATOR_SESSION_TOKEN: token,
      ORCHESTRATOR_URL: this.mcpUrl,
    };
    if (profileEnv && typeof profileEnv === 'object') {
      for (const [key, value] of Object.entries(
        renderJson(profileEnv as Record<string, string>, ctx),
      )) {
        env[key] = String(value);
      }
    }
    return env;
  }

  private attachPty(sessionId: string, tmuxSession: string, cwd: string) {
    const existing = this.handles.get(sessionId);
    if (existing) return;

    const buffer = new OutputBuffer((chunk) => {
      void this.persistLogChunk(sessionId, chunk);
    });

    if (!ptyRegistry.exists(tmuxSession)) {
      this.logger.warn(`Cannot attach session ${sessionId}: pane ${tmuxSession} is not running`);
      return;
    }

    const handle: RuntimeHandle = {
      detach: () => undefined,
      tmuxSession,
      buffer,
      lastOutputAt: new Date(),
      sawOutput: false,
    };

    // `replay: false` de propósito: este assinante alimenta o log persistido e
    // o `lastOutputAt`, não uma tela. Reenviar o snapshot aqui gravaria a tela
    // inteira como LogEntry a cada reattach e marcaria `sawOutput` sem que o
    // CLI tivesse escrito nada — exatamente a cegueira de stall check da MT-11.
    // Quem precisa de replay é o /terminal, e lá o attach pede.
    handle.detach = ptyRegistry.attach(
      tmuxSession,
      (data) => {
        handle.lastOutputAt = new Date();
        handle.sawOutput = true;
        buffer.push(data);
        void this.redis.publish('session:log', {
          sessionId,
          stream: 'pty',
          chunk: data,
          ts: new Date().toISOString(),
        });
      },
      {
        replay: false,
        onExit: (exitCode) => {
          buffer.dispose();
          this.handles.delete(sessionId);
          this.logger.log(`Pane for session ${sessionId} exited (${exitCode})`);
        },
      },
    );

    this.handles.set(sessionId, handle);
  }

  private async persistLogChunk(sessionId: string, chunk: string) {
    try {
      await this.prisma.logEntry.create({
        data: {
          sessionId,
          level: 'info',
          message: chunk,
          metadata: { stream: 'pty' },
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to persist log chunk for ${sessionId}: ${error.message}`);
    }
  }

  /**
   * Último sinal de vida da sessão. Ordem de preferência (a primeira que
   * responde ganha):
   *
   * 1. Último output do pane, via `readWindowActivity` — a fonte mais fiel
   *    enquanto o pane existe: o CLI escrevendo no pane a atualiza.
   * 2. `createdAt` do último `LogEntry` da sessão.
   * 3. Handle vivo que já recebeu output.
   *
   * A fonte 2 deixou de ser caso de borda quando o tmux saiu. Antes a 1 vivia
   * no servidor tmux e sobrevivia ao restart do backend; hoje ela vive no
   * processo, então DEPOIS DE TODO RESTART a 1 responde `null` e o
   * `log_entries` é o único sinal que sobrou. É ele que impede o stall check de
   * ficar cego justo quando mais importa (MT-11) — e o motivo de o
   * `persistLogChunk` ter que continuar gravando, por mais barulhento que seja.
   *
   * `session.updatedAt` foi deliberadamente descartado: qualquer escrita do
   * próprio watchdog (pid do reattach, `_watchdog`) o empurraria para "agora" e
   * a sessão pareceria viva justamente quando não está. Ver decisoes/mt-11.md.
   */
  private async resolveLastActivity(
    sessionId: string,
    tmuxSession: string | null,
  ): Promise<SessionActivity> {
    if (tmuxSession) {
      const epochSeconds = await this.readWindowActivity(tmuxSession);
      if (epochSeconds !== null) {
        return { at: new Date(epochSeconds * 1000), source: 'tmux' };
      }
    }

    const lastLog = await this.prisma.logEntry.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (lastLog) return { at: lastLog.createdAt, source: 'log' };

    const handle = this.handles.get(sessionId);
    if (handle?.sawOutput) return { at: handle.lastOutputAt, source: 'pty' };

    return { at: null, source: 'none' };
  }

  /**
   * Último output do pane em epoch de SEGUNDOS (a unidade que o
   * `resolveLastActivity` multiplica por 1000) — `null` quando o pane não
   * existe mais.
   *
   * Substitui o `#{window_activity}` do tmux. Perdeu uma propriedade no
   * caminho, e ela importa: o valor do tmux vivia no servidor tmux, então
   * sobrevivia ao restart do backend. Este vive no processo do backend. Depois
   * de um restart o pane não existe e isto devolve `null` — o fallback para o
   * `createdAt` do último `LogEntry` (fonte 2 do `resolveLastActivity`) deixa
   * de ser um caso de borda e passa a ser o caminho normal. É o que mantém o
   * stall check enxergando algo em vez de ficar cego, como na MT-11.
   */
  private async readWindowActivity(tmuxSession: string): Promise<number | null> {
    const epochMs = ptyRegistry.lastActivity(tmuxSession);
    return epochMs === null ? null : Math.floor(epochMs / 1000);
  }

  /**
   * Rede de segurança contra sessão travada. Varre as sessões ativas **do
   * banco**, não o Map de handles: iterar o Map era o bug 2 da MT-11 — com o
   * backend reiniciando, o Map nasce vazio e o loop não avaliava nada, então
   * nenhuma sessão era marcada como travada exatamente no cenário em que a rede
   * é mais necessária.
   */
  private async checkStalledSessions() {
    // O método roda de `setInterval` com `void`: qualquer rejeição que escape
    // daqui é unhandled rejection e mata a rede de segurança em silêncio — o
    // mesmo modo de falha que esta task existe para eliminar.
    try {
      await this.runStallCheck();
    } catch (error) {
      this.logger.warn(`Stall check round failed: ${error.message}`);
    }
  }

  /**
   * Sessão parada num menu de aprovação do CLI. Devolve `true` quando havia
   * diálogo — quem chama deve PULAR o resto da avaliação, porque as heurísticas
   * de silêncio não se aplicam: o pane não está travado, está esperando alguém
   * responder.
   *
   * Sempre registra o diálogo (é o que transforma "parou em alguma etapa" em
   * "parou pedindo `xxd`"). Responder sozinho é opt-in por
   * `ORCHESTR_AUTO_APPROVE_DIALOGS=1`, porque aceitar comando arbitrário sem
   * ninguém olhando é decisão de quem opera, não default.
   *
   * A opção escolhida é a "1" por ser a afirmativa na esmagadora maioria dos
   * menus do CLI. Há exceção conhecida — o aviso de Bypass Permissions inverte
   * a ordem e põe "No, exit" em primeiro —, mas esse modo já é inutilizável em
   * execução desassistida por outros motivos, então não vale um parser de
   * intenção só para ele.
   */
  private async handleApprovalDialog(session: {
    id: string;
    tmuxSession: string | null;
  }): Promise<boolean> {
    if (!session.tmuxSession || !ptyRegistry.exists(session.tmuxSession)) return false;

    const dialog = detectApprovalDialog(await this.capturePane(session.tmuxSession));
    if (!dialog) return false;

    const resumo = `${dialog.question} — ${dialog.subject}`.slice(0, 300);
    this.logger.warn(`Session ${session.id} is blocked on a CLI dialog: ${resumo}`);
    await this.prisma.logEntry
      .create({
        data: {
          sessionId: session.id,
          level: 'warn',
          message: `Sessão parada em diálogo do CLI: ${resumo}`,
          metadata: {
            kind: 'approval-dialog',
            question: dialog.question,
            subject: dialog.subject,
            options: dialog.options,
          },
        },
      })
      .catch((error) => this.logger.warn(`Failed to persist approval-dialog log: ${error.message}`));

    if (process.env.ORCHESTR_AUTO_APPROVE_DIALOGS === '1') {
      this.logger.warn(`Session ${session.id}: auto-approving CLI dialog — ${resumo}`);
      ptyRegistry.write(session.tmuxSession, '1');
      await this.sleep(150);
      ptyRegistry.sendEnter(session.tmuxSession);
    }
    return true;
  }

  private async runStallCheck() {
    const sessions = await this.prisma.session.findMany({
      where: { status: { in: ['running', 'waiting'] } },
      select: {
        id: true,
        status: true,
        currentStage: true,
        stageData: true,
        tmuxSession: true,
        stalledAt: true,
        startedAt: true,
        context: true,
        macroTask: { select: { pipeline: { select: { stages: true } } } },
        // Sessão com pergunta pendente está legitimamente parada esperando
        // resposta humana — silêncio ali não é travamento e reprompt viraria
        // spam a cada rodada do check.
        questions: { where: { status: 'pending' }, select: { id: true }, take: 1 },
      },
    });

    const now = Date.now();
    for (const session of sessions) {
      try {
        // Diálogo do CLI é verificado ANTES de qualquer conta de tempo, e para
        // TODA sessão viva — não só as que parecem silenciosas.
        //
        // O motivo é específico: com um menu aberto o CLI continua animando o
        // spinner na barra de status, então `resolveLastActivity` devolve
        // "ativa agora" e o `elapsed` nunca cruza o limiar. Pendurado no
        // caminho de sessão travada, o detector jamais rodaria justamente no
        // caso que ele existe para pegar — foi assim que a primeira versão
        // desta checagem passou 12 minutos sem disparar num pane parado em
        // "Do you want to proceed?".
        if (await this.handleApprovalDialog(session)) continue;

        const activity = await this.resolveLastActivity(session.id, session.tmuxSession);
        // Sem nenhum sinal (sessão que nunca logou nada), conta desde o start.
        const since = activity.at ?? session.startedAt;
        const elapsed = now - since.getTime();
        if (elapsed < this.stallTimeoutMs) {
          // Dentro do prazo e marcada: voltou a produzir. Este caminho roda
          // ANTES do filtro de pergunta pendente de propósito — a pergunta que
          // bloquearia a avaliação é, no caso mais comum, a que o próprio
          // watchdog abriu ao escalar, e a sessão nunca seria reavaliada.
          if (session.stalledAt) await this.recoverStalledSession(session, activity, elapsed);
          continue;
        }

        if (session.questions.length > 0) continue;
        await this.handleSilentSession(session, activity, elapsed);
      } catch (error) {
        // Uma sessão problemática não pode impedir a varredura das outras.
        this.logger.warn(`Stall handling failed for ${session.id}: ${error.message}`);
      }
    }
  }

  /**
   * Sessão ativa sem sinal de vida há mais que `stallTimeoutMs`. Três saídas,
   * nesta ordem:
   *
   * - stage `mode: engine` (o `Merge`): não há agente esperando prompt, então
   *   reprompt não tem para onde ir — escala direto para `Question`. Foi onde a
   *   MT-7 ficou 1h20 parada com 2 commits prontos.
   * - turno encerrado sem `complete_stage` (pane idle, stage sem `completedAt`):
   *   reprompta pedindo para fechar o stage. Não mata — empurra.
   * - reprompts esgotados, ou pane que não está idle (spinner congelado): marca
   *   `stalledAt` e escala para `Question`.
   */
  private async handleSilentSession(
    session: {
      id: string;
      status: string;
      currentStage: string;
      stageData: unknown;
      tmuxSession: string | null;
      stalledAt: Date | null;
      context: unknown;
      macroTask?: { pipeline?: { stages: unknown } | null } | null;
      questions: { id: string }[];
    },
    activity: SessionActivity,
    elapsed: number,
  ): Promise<void> {
    const minutes = Math.round(elapsed / 60_000);
    const stage = session.currentStage;
    const stageData =
      session.stageData && typeof session.stageData === 'object' && !Array.isArray(session.stageData)
        ? (session.stageData as Record<string, any>)
        : {};
    const stageDone = !!stageData[stage]?.completedAt;

    // Stage já fechado e sessão parada é trabalho do engine (avanço de stage),
    // não travamento de agente: não empurra nem alarma.
    if (stageDone) return;

    const isEngineStage = this.isEngineStage(session, stage);
    // Sem tmux vivo não há para onde mandar o reprompt: `sendPrompt` lançaria e
    // a sessão nunca chegaria a ser marcada. Aí é caso de escalar, não empurrar.
    const tmuxAlive = !!session.tmuxSession && (await this.tmuxSessionExists(session.tmuxSession));
    const watchdog = this.readWatchdogState(session.stageData, stage);
    // Stage `engine` não tem pane de agente: não há tela para comparar, e o
    // caminho dele é escalar de qualquer forma.
    const pane = isEngineStage
      ? { idle: true, paneHash: watchdog.paneHash }
      : await this.isPaneIdle(session.tmuxSession, watchdog.paneHash);
    // A tela desta rodada é a base de comparação da próxima e precisa ficar
    // gravada mesmo quando o resto do método não faz mais nada (sessão já
    // marcada) — senão nunca existiriam duas capturas para comparar.
    if (pane.paneHash !== watchdog.paneHash) {
      await this.writeWatchdogState(session.id, { ...watchdog, paneHash: pane.paneHash });
    }
    const canReprompt =
      !isEngineStage &&
      tmuxAlive &&
      pane.idle &&
      watchdog.repromptCount < this.stallMaxReprompts;

    if (canReprompt) {
      const attempt = watchdog.repromptCount + 1;
      this.logger.warn(
        `Session ${session.id} silent for ${minutes}min in "${stage}" (source ${activity.source}) — reprompting to close the stage (${attempt}/${this.stallMaxReprompts})`,
      );
      // Persiste a tentativa ANTES de enviar: se o backend morrer no meio (o
      // cenário desta task), o pior caso é gastar um reprompt sem mandar. Na
      // ordem inversa o contador nunca subiria e o watchdog empurraria a mesma
      // sessão para sempre, a cada restart.
      await this.writeWatchdogState(session.id, {
        repromptCount: attempt,
        lastRepromptAt: new Date().toISOString(),
        stage,
        paneHash: pane.paneHash,
      });
      await this.sendPrompt(session.id, this.buildClosePrompt(stage, minutes));
      await this.redis.publish(CHANNELS.SESSION_STALLED, {
        sessionId: session.id,
        status: session.status,
        stage,
        reason: 'turn_ended_without_complete_stage',
        elapsedMinutes: minutes,
        activitySource: activity.source,
        repromptCount: attempt,
        stalledAt: null,
      });
      return;
    }

    // Já marcada: não repete Question nem alarme a cada rodada do check.
    if (session.stalledAt) return;

    const reason = isEngineStage
      ? 'engine_stage_without_complete'
      : !tmuxAlive
        ? 'tmux_gone'
        : watchdog.repromptCount >= this.stallMaxReprompts
          ? 'reprompt_exhausted'
          : 'no_activity';

    this.logger.warn(
      `Session ${session.id} stalled — no activity for ${minutes}min in "${stage}" (source ${activity.source}, reason ${reason})`,
    );
    await this.prisma.session.update({
      where: { id: session.id },
      data: { stalledAt: new Date() },
    });
    await this.escalateToQuestion(session.id, stage, minutes, reason);
    await this.redis.publish(CHANNELS.SESSION_STALLED, {
      sessionId: session.id,
      status: session.status,
      stage,
      reason,
      elapsedMinutes: minutes,
      activitySource: activity.source,
      repromptCount: watchdog.repromptCount,
      stalledAt: new Date().toISOString(),
    });
  }

  /**
   * Sessão marcada como travada que voltou a dar sinal de vida. Desfaz o alarme
   * inteiro — `stalledAt`, o orçamento de reprompt do stage e a `Question` que o
   * escalonamento abriu.
   *
   * Existe porque o desfecho *esperado* do reprompt automático é justamente
   * este (o agente volta a trabalhar) e não havia caminho de volta: só
   * `startSession`, `rebootCli` e `resumeSession` limpavam `stalledAt`, todos
   * por ação humana. O banner "Session stalled" ficava aceso para sempre e o
   * Master seguia tratando a sessão como suspeita.
   */
  private async recoverStalledSession(
    session: { id: string; currentStage: string },
    activity: SessionActivity,
    elapsed: number,
  ): Promise<void> {
    const stage = session.currentStage;
    this.logger.log(
      `Session ${session.id} recovered in "${stage}" — last signal ${Math.round(elapsed / 60_000)}min ago (source ${activity.source}), clearing stalledAt`,
    );
    await this.prisma.session.update({
      where: { id: session.id },
      data: { stalledAt: null },
    });
    // Orçamento de reprompt volta ao início: sem isto a primeira recuperação
    // condenaria o stage a escalar direto no travamento seguinte, com o
    // contador já gasto.
    await this.writeWatchdogState(session.id, {
      repromptCount: 0,
      lastRepromptAt: '',
      stage,
      paneHash: '',
    });
    await this.dismissWatchdogQuestion(session.id);
  }

  /**
   * Fecha a `Question` que o watchdog abriu, agora que a sessão voltou a
   * produzir: sai do inbox e fica no histórico. Sem isto o alarme-fantasma
   * mudava de lugar — apagava no banner e continuava aberto em /questions.
   *
   * Usa a mesma convenção do `QuestionsService.dismiss` (`dismissed` + `answer`
   * + `metadata.audit` + `QUESTION_ANSWERED`) em vez de chamá-lo: o serviço tipa
   * `dismissedBy` como humano/master e injetá-lo aqui acrescentaria aresta de
   * módulo a um serviço que já carrega um `forwardRef` com o engine. O publish
   * importa: é por ele que o `pipeline-engine` tira a sessão de `waiting`.
   *
   * Só fecha pergunta de `metadata.source === 'watchdog'` — pergunta de humano
   * ou de agente não é dele para fechar. E deliberadamente **não** grava
   * `LogEntry` na sessão, como o dismiss manual faz: a linha viraria sinal de
   * vida na rodada seguinte do próprio detector (invariante da MT-11).
   */
  private async dismissWatchdogQuestion(sessionId: string): Promise<void> {
    try {
      const pending = await this.prisma.question.findMany({
        where: { sessionId, status: 'pending' },
        select: { id: true, metadata: true },
      });
      for (const row of pending) {
        const meta = (row.metadata as Record<string, any>) || {};
        if (meta.source !== 'watchdog') continue;
        const answer =
          'DISMISSED: a sessão voltou a produzir output por conta própria — o travamento se resolveu sem intervenção.';
        const question = await this.prisma.question.update({
          where: { id: row.id },
          data: {
            status: 'dismissed',
            answer,
            answeredAt: new Date(),
            metadata: {
              ...meta,
              audit: {
                dismissedBy: 'watchdog',
                reason: 'session recovered',
                at: new Date().toISOString(),
              },
            },
          },
        });
        await this.redis.publish(CHANNELS.QUESTION_ANSWERED, question);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to dismiss watchdog question for ${sessionId}: ${error.message}`,
      );
    }
  }

  /**
   * `true` se o stage corrente roda no orquestrador (`mode: engine`, o `Merge`)
   * em vez de num agente. Sem pipeline carregado, cai no mesmo default do
   * `pipeline-engine.executeStage`: só `Merge` é engine.
   */
  private isEngineStage(
    session: { id: string; context: unknown; macroTask?: { pipeline?: { stages: unknown } | null } | null },
    stage: string,
  ): boolean {
    const warnings: string[] = [];
    const pipeline = this.loadPipelineFor(session as SessionForStageRuntime, warnings);
    const definition = pipeline?.stages.find((s) => s.name === stage);
    return (definition?.mode ?? (stage === 'Merge' ? 'engine' : 'interactive')) === 'engine';
  }

  /**
   * Pane sem sinal de trabalho em curso, com o hash da tela para a próxima
   * rodada. O sinal é a tela ter **mudado** entre duas rodadas do check: tela
   * idêntica = ninguém está escrevendo ali. É o mesmo par de capturas
   * comparadas que o `waitForPaneReady` já usa, só espaçado pelo intervalo do
   * check em vez de por um sleep — e não custa captura extra.
   *
   * Independe de glifo e de vocabulário de CLI, que era o furo da heurística
   * anterior: pane parado exibindo saída de teste com a palavra "running" era
   * lido como CLI trabalhando e o reprompt nunca disparava. `PANE_BUSY_PATTERN`
   * sobrou como desempate da primeira rodada num stage, quando ainda não há
   * captura anterior; errar para "ocupado" ali só custa um intervalo de atraso.
   *
   * Sem tmux (ou pane vazio) assume idle — é o caso mais comum e mantém o
   * comportamento anterior.
   */
  private async isPaneIdle(
    tmuxSession: string | null,
    previousHash: string,
  ): Promise<{ idle: boolean; paneHash: string }> {
    if (!tmuxSession) return { idle: true, paneHash: '' };
    const pane = await this.capturePane(tmuxSession);
    const tail = pane.replace(/\s+$/, '').split('\n').slice(-12).join('\n');
    if (!tail) return { idle: true, paneHash: '' };
    const paneHash = createHash('sha1').update(tail).digest('hex');
    if (!previousHash) return { idle: !PANE_BUSY_PATTERN.test(tail), paneHash };
    return { idle: paneHash === previousHash, paneHash };
  }

  /** Mensagem de destravamento. A versão que o Master mandou na mão nos dois
   * deadlocks da Onda 1 funcionou de primeira: dizer exatamente qual ferramenta
   * está faltando, sem reabrir o trabalho do stage. */
  private buildClosePrompt(stage: string, minutes: number): string {
    return [
      `[watchdog] Sua sessão está sem output há ${minutes} minutos e o stage "${stage}" segue sem \`complete_stage\`.`,
      '',
      'O pipeline está bloqueado esperando esse sinal. Se o trabalho do stage já está feito:',
      `chame \`complete_stage\` com stage="${stage}" e um summary curto agora.`,
      '',
      'Se ainda falta algo, continue de onde parou e feche o stage ao terminar.',
      'Se está bloqueado por uma decisão, use `submit_question` — não encerre o turno em silêncio.',
    ].join('\n');
  }

  private readWatchdogState(stageData: unknown, stage: string): WatchdogState {
    const empty: WatchdogState = { repromptCount: 0, lastRepromptAt: '', stage, paneHash: '' };
    if (!stageData || typeof stageData !== 'object' || Array.isArray(stageData)) return empty;
    const raw = (stageData as Record<string, unknown>)._watchdog;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
    const state = raw as Partial<WatchdogState>;
    // Contagem de outro stage não vale para este: cada stage tem direito ao seu
    // orçamento de reprompts.
    if (state.stage !== stage) return empty;
    return {
      repromptCount: typeof state.repromptCount === 'number' ? state.repromptCount : 0,
      lastRepromptAt: typeof state.lastRepromptAt === 'string' ? state.lastRepromptAt : '',
      stage,
      // Ausente no estado gravado antes da MT-23: cai na primeira rodada, que
      // é exatamente o que ele significa.
      paneHash: typeof state.paneHash === 'string' ? state.paneHash : '',
    };
  }

  /**
   * Grava `_watchdog` com merge **atômico** no banco (`jsonb ||`), não com
   * read-modify-write como o `stampRuntime`. A diferença importa aqui: este
   * write acontece milissegundos depois de pedir `complete_stage` ao agente, e
   * um read-modify-write perderia o `stageData[stage].completedAt` que o agente
   * acabou de gravar — apagando justamente o sinal que o watchdog foi buscar e
   * deixando o pipeline parado de novo. Nunca lança (é metadado).
   */
  private async writeWatchdogState(sessionId: string, state: WatchdogState): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE sessions
        SET stage_data = COALESCE(stage_data, '{}'::jsonb) || ${JSON.stringify({ _watchdog: state })}::jsonb
        WHERE id = ${sessionId}
      `;
    } catch (error) {
      this.logger.warn(`Failed to persist watchdog state for ${sessionId}: ${error.message}`);
    }
  }

  /**
   * Abre uma `Question` para a sessão travada. Grava via Prisma e publica o
   * mesmo canal que o `QuestionsService.create` — o `pipeline-engine` escuta
   * `QUESTION_CREATED` e passa a sessão para `waiting`, que é o efeito
   * desejado: para de fingir progresso e aparece na fila de perguntas.
   * Idempotente por stage: uma pergunta de watchdog pendente basta.
   */
  private async escalateToQuestion(
    sessionId: string,
    stage: string,
    minutes: number,
    reason: string,
  ): Promise<void> {
    try {
      const pending = await this.prisma.question.findFirst({
        where: { sessionId, status: 'pending' },
        select: { id: true },
      });
      if (pending) return;

      const question = await this.prisma.question.create({
        data: {
          sessionId,
          question:
            `[watchdog] Sessão sem sinal de vida há ${minutes} min no stage "${stage}" ` +
            `(${reason}) e o stage nunca foi fechado. Inspecione o pane e decida: ` +
            'destravar com um prompt novo, pular o stage ou matar a sessão.',
          priority: 'high',
          metadata: { source: 'watchdog', stage, reason, silentMinutes: minutes },
        },
      });
      await this.redis.publish(CHANNELS.QUESTION_CREATED, question);
    } catch (error) {
      this.logger.warn(`Failed to escalate stalled ${sessionId} to a question: ${error.message}`);
    }
  }

  /**
   * Restart manual do CLI da sessão, com a mesma precedência do boot inicial
   * (§3) para a fase corrente (`session.currentStage`).
   */
  async restartCli(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        agent: { include: { cliProfile: true } },
        macroTask: { include: { project: true, pipeline: true } },
      },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    const phase = session.currentStage || null;
    const resolved = await this.resolveStageRuntime(session, phase);
    await this.logRuntimeWarnings(sessionId, resolved.warnings, phase);
    await this.rebootCli(session, resolved, phase, 'restart');
  }

  /**
   * Mata o processo do pane e sobe o CLI de novo com o profile/model de
   * `resolved`. Compartilhado por `restartCli()` (restart manual) e
   * `applyPhaseRuntime()` (troca de fase). Ao final registra o
   * `stageData._runtime` do boot novo.
   */
  private async rebootCli(
    session: SessionForRuntime & {
      mcpToken: string;
      tmuxSession: string | null;
      worktreePath: string | null;
    },
    resolved: StageRuntime,
    phase: string | null,
    action: 'restart' | 'phase-switch',
    detail?: string,
  ): Promise<void> {
    const sessionId = session.id;
    const profile = resolved.profile;

    const handle = this.handles.get(sessionId);
    if (handle) {
      handle.detach();
      handle.buffer.dispose();
      this.handles.delete(sessionId);
    }

    const tmuxSession = session.tmuxSession || this.tmuxName(sessionId);
    if (await this.tmuxSessionExists(tmuxSession)) {
      // `respawn` MATA o processo do pane (um C-c só interrompe o turno do CLI,
      // que continua vivo) e devolve um shell limpo com o mesmo nome — as abas
      // do /terminal já anexadas continuam anexadas, porque o registry
      // transfere os assinantes para o pane novo.
      ptyRegistry.respawn(tmuxSession, session.worktreePath || '.');
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!session.worktreePath) {
      throw new Error(`Session ${sessionId} has no worktree path`);
    }

    const ctx: RenderContext = {
      model: resolved.config.model,
      url: this.mcpUrl,
      token: session.mcpToken,
      sessionId: session.id,
      permissionMode: resolved.config.permissionMode || 'acceptEdits',
      // sem isto o renderer descarta "--mcp-config {{mcpConfigPath}}" e, com
      // --strict-mcp-config, o CLI sobe SEM NENHUM MCP (nem o orchestrator)
      mcpConfigPath: path.join(session.worktreePath, profile.mcpConfigFile),
    };

    this.attachPty(sessionId, tmuxSession, session.worktreePath);

    const interactiveArgs = renderArgs(profile.interactiveArgs as string[], ctx);
    const commandLine = buildCommandLine(profile.binary, interactiveArgs);
    // Pane precisa estar de volta no shell antes de colar o comando de boot.
    await this.waitForPaneReady(tmuxSession, { timeoutMs: 15_000 });
    await this.pasteAndSubmit(tmuxSession, commandLine, sessionId, 'CLI boot command');

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'running',
        stalledAt: null,
        pid: ptyRegistry.pid(tmuxSession) ?? null,
      },
    });

    const stamp = await this.stampRuntime(sessionId, resolved, phase);
    await this.logRuntimeBoot(sessionId, stamp, action, detail);
    await this.redis.publish(CHANNELS.SESSION_STATUS, { sessionId, status: 'running' });
    this.logger.log(`Session ${sessionId} CLI restarted in tmux ${tmuxSession}`);
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    const tmuxSession = await this.resolveTmuxSession(sessionId);
    // O CLI pode ainda estar bootando (tela de boas-vindas): espera o pane
    // estabilizar antes de colar, senão o texto se perde ou fica sem Enter.
    await this.waitForPaneReady(tmuxSession, { timeoutMs: 90_000 });
    // CLI pode ter crashado e deixado só o shell do host no pane: colar aqui
    // (ver `isBareShellPrompt`) faria o shell EXECUTAR o prompt como comando
    // em vez de recebê-lo como texto de chat.
    if (isBareShellPrompt(await this.capturePane(tmuxSession))) {
      throw new Error(
        `Session ${sessionId}: CLI appears to have exited — tmux ${tmuxSession} shows a bare shell prompt, refusing to paste a prompt into it`,
      );
    }
    await this.pasteAndSubmit(tmuxSession, prompt, sessionId, 'stage prompt');
  }

  /**
   * Entrega o texto ao pane em bracketed paste — o par `load-buffer` +
   * `paste-buffer -p` do tmux. O ponto continua o mesmo: nada é interpretado
   * pelo shell no envio, e o CLI TUI recebe multi-linha como UMA colagem em vez
   * de uma sequência de Enters.
   */
  private async pasteToTmux(tmuxSession: string, text: string): Promise<void> {
    ptyRegistry.paste(tmuxSession, text);
  }

  write(sessionId: string, data: string): void {
    const handle = this.handles.get(sessionId);
    if (!handle) throw new NotFoundException(`No live runtime for session ${sessionId}`);
    ptyRegistry.write(handle.tmuxSession, data);
  }

  isRunning(sessionId: string): boolean {
    return this.handles.has(sessionId);
  }

  async resolveTmuxSession(sessionId: string): Promise<string> {
    const handle = this.handles.get(sessionId);
    if (handle) return handle.tmuxSession;
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { tmuxSession: true },
    });
    if (session?.tmuxSession && (await this.tmuxSessionExists(session.tmuxSession))) {
      return session.tmuxSession;
    }
    throw new NotFoundException(`No tmux session for session ${sessionId}`);
  }

  /**
   * Nomes de todos os servidores MCP visíveis no worktree: config gerado da
   * sessão + .mcp.json do worktree (ou do repo principal, se ainda não copiado).
   */
  private async collectMcpServerNames(
    worktreePath: string,
    mainRepoPath: string,
    sessionMcpConfig: Record<string, unknown>,
  ): Promise<string[]> {
    const names = new Set<string>();
    const harvest = (cfg: unknown) => {
      if (!cfg || typeof cfg !== 'object') return;
      for (const key of ['mcpServers', 'mcp']) {
        const servers = (cfg as Record<string, unknown>)[key];
        if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
          for (const name of Object.keys(servers)) names.add(name);
        }
      }
    };
    harvest(sessionMcpConfig);
    for (const base of [worktreePath, mainRepoPath]) {
      try {
        harvest(JSON.parse(await fs.readFile(path.join(base, '.mcp.json'), 'utf8')));
      } catch {
        // sem .mcp.json ou inválido — ignora
      }
    }
    return [...names];
  }

  async resumeSession(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        agent: { include: { cliProfile: true } },
        macroTask: { include: { project: true } },
      },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (!['running', 'waiting', 'paused'].includes(session.status)) {
      throw new Error(`Cannot resume session in status ${session.status}`);
    }

    const tmuxSession = session.tmuxSession || this.tmuxName(sessionId);
    const tmuxExists = await this.tmuxSessionExists(tmuxSession);

    if (tmuxExists) {
      await this.reattachToLiveTmux(sessionId, tmuxSession, session.worktreePath, {
        clearStalled: true,
      });
      await this.redis.publish(CHANNELS.SESSION_STATUS, { sessionId, status: session.status });
      this.logger.log(`Session ${sessionId} resumed (reattached to tmux ${tmuxSession})`);
    } else {
      await this.startSession(sessionId);
      this.logger.log(`Session ${sessionId} resumed (recreated tmux and CLI)`);
    }
  }

  /**
   * Telemetria de runtime consumida pelo mcp-server: estado do PTY, do tmux
   * e um snapshot das últimas linhas do pane.
   */
  /**
   * Estado do vínculo com o CLI, sem capturar o pane. Separado de
   * `getRuntimeTelemetry` porque a listagem de sessões chama isto por sessão:
   * `capture-pane` num loop custa caro e a lista não mostra tela.
   */
  async getLiveness(sessionId: string): Promise<SessionLiveness> {
    const handle = this.handles.get(sessionId);

    let tmuxSession = handle?.tmuxSession;
    if (!tmuxSession) {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { tmuxSession: true },
      });
      tmuxSession = session?.tmuxSession || this.tmuxName(sessionId);
    }
    const tmuxAlive = await this.tmuxSessionExists(tmuxSession);
    const activity = await this.resolveLastActivity(sessionId, tmuxAlive ? tmuxSession : null);

    return {
      hasPty: !!handle,
      tmuxAlive,
      lastOutputAt: handle ? handle.lastOutputAt.toISOString() : null,
      // Vínculo perdido: o CLI está vivo no tmux mas o backend não tem PTY para
      // ele. `lastOutputAt: null` sozinho é ambíguo (a UI lia como "sem
      // informação"); este campo diz que a informação existe e nós a perdemos.
      linkLost: !handle && tmuxAlive,
      lastActivityAt: activity.at ? activity.at.toISOString() : null,
      activitySource: activity.source,
      tmuxSession,
    };
  }

  async getRuntimeTelemetry(sessionId: string): Promise<SessionLiveness & { lastScreen?: string }> {
    const liveness = await this.getLiveness(sessionId);

    let lastScreen: string | undefined;
    if (liveness.tmuxAlive) {
      const pane = await this.capturePane(liveness.tmuxSession);
      const lines = pane.replace(/\s+$/, '').split('\n');
      lastScreen = lines.slice(-15).join('\n');
    }

    return {
      ...liveness,
      ...(lastScreen !== undefined ? { lastScreen } : {}),
    };
  }

  /** Notifica a UI (/git) que o estado git do projeto mudou. Nunca quebra o fluxo. */
  private async publishGitChanged(event: GitChangedEvent): Promise<void> {
    try {
      await this.redis.publish(CHANNELS.GIT_CHANGED, event);
    } catch (error) {
      this.logger.warn(`Failed to publish git:changed (${event.reason}): ${error.message}`);
    }
  }

  async stop(sessionId: string, opts?: { removeWorktree?: boolean }): Promise<void> {
    const handle = this.handles.get(sessionId);
    if (handle) {
      handle.buffer.dispose();
      handle.detach();
      this.handles.delete(sessionId);
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { macroTask: { include: { project: true } } },
    });
    const tmuxSession = session?.tmuxSession || this.tmuxName(sessionId);
    if (await this.tmuxSessionExists(tmuxSession)) {
      try {
        // `killPane` limpa os assinantes antes de matar o processo, então
        // ninguém recebe `onExit` de um pane que já saiu do registry.
        await killPane(tmuxSession);
      } catch (error) {
        this.logger.warn(`Failed to kill pane ${tmuxSession}: ${error.message}`);
      }
    }

    if (opts?.removeWorktree && session?.worktreePath && session.macroTask?.project) {
      try {
        await this.workspace.removeWorktree(
          session.macroTask.project.mainPath,
          session.worktreePath,
        );
        await this.publishGitChanged({
          projectId: session.macroTask.project.id,
          reason: 'worktree-removed',
          ts: new Date().toISOString(),
          sessionId,
          branch: session.branchName,
        });
      } catch (error) {
        this.logger.warn(`Failed to remove worktree ${session.worktreePath}: ${error.message}`);
      }
    }
  }

  onModuleDestroy() {
    if (this.stallCheckInterval) {
      clearInterval(this.stallCheckInterval);
    }
    for (const [sessionId, handle] of this.handles) {
      handle.buffer.dispose();
      handle.detach();
      this.logger.log(`Detached pane for session ${sessionId} on shutdown`);
    }
    this.handles.clear();
    // Antes daqui só caíam os clientes de attach — os CLIs seguiam vivos no
    // servidor tmux e o boot seguinte reanexava. Sem tmux o pane é filho deste
    // processo: ou ele é morto aqui, ou vira ConPTY órfão segurando o worktree.
    ptyRegistry.killAll();
  }
}
