import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CHANNELS, MasterActivityEvent, QuestionEvent } from '../redis/channels';
import {
  MASTER_ACTIVE_PROJECTS_KEY,
  MASTER_CHAT_RUN_KEY,
  MASTER_CHAT_SESSION_KEY,
  MASTER_CHAT_SESSION_TTL_SECONDS,
  MASTER_STATE_KEY,
  MasterState,
  masterStateKey,
  masterTokenIndexKey,
} from '../redis/keys';
import { MasterRuntimeService } from './master-runtime.service';
import { ProjectsService } from '../projects/projects.service';
import { describeProvenance, resolveRuntimeConfig } from '../config';
import { readNextTickAt, syncMasterTickJob } from '../scheduled-jobs/master-tick';
import {
  applySchedulingPatch,
  assertValidSchedulingPatch,
  AUTOMATION_SETTINGS_KEY,
  DEFAULT_SCHEDULING_CONFIG,
  loadSchedulingConfig as loadSchedulingConfigFromStore,
  persistSchedulingConfig as persistSchedulingConfigToStore,
  schedulingConfigsEqual,
  SchedulingConfig,
} from './master-scheduling.config';

export type { SchedulingConfig } from './master-scheduling.config';

/** Uma execução (triagem/chat/health-check) do Master no ring buffer do feed. */
export interface MasterActivityRun {
  runId: string;
  /** Projeto do Master que rodou (MT-20: há um por projeto). */
  projectId?: string;
  kind: 'triage' | 'chat' | 'health';
  questionId?: string;
  promptPreview: string;
  startedAt: string;
  output: string;
  endedAt?: string;
  exitCode?: number;
  result?: string;
  action?: 'answer' | 'escalate';
  error?: string;
}

/** Resumo de uma conversa do chat do Master, derivado das próprias mensagens. */
export interface ChatSessionSummary {
  chatSessionId: string;
  title: string;
  messageCount: number;
  createdAt: string | null;
  lastMessageAt: string | null;
}

/** Corte do título derivado da primeira mensagem do usuário. */
const CHAT_SESSION_TITLE_MAX = 60;
/** Rótulo quando a conversa não tem nenhuma mensagem `role: 'user'`. */
const CHAT_SESSION_FALLBACK_TITLE = 'Conversation';

const MAX_ACTIVITY_RUNS = 50;
const MAX_RUN_OUTPUT = 64_000;

/**
 * Cadência do vigia do terminal do Master. 30s é o mesmo horizonte do watchdog
 * de processo (`watchdog.sh`): rápido o bastante para o humano não ver o Master
 * "mudo", devagar o bastante para ser um `tmux has-session` por meio minuto.
 * MT-20: o vigia passou a rodar UMA vez para o processo inteiro, varrendo
 * todos os projetos com Master ativo — não há mais "o" terminal, há um por
 * projeto, e o custo de checar todos a cada 30s é irrelevante.
 */
const TERMINAL_WATCH_INTERVAL_MS = 30_000;

/**
 * Estado do Master DE UM projeto (MT-20). Tudo o que era campo escalar do
 * serviço mora aqui: com N Masters vivos, `this.tickRunning` global significaria
 * que o tick do projeto A cancela o do projeto B — o mesmo vale para o vigia
 * do terminal (`terminalBusy`), que também é por projeto.
 */
interface MasterProjectRuntime {
  projectId: string;
  cliProfileId: string;
  mcpToken: string;
  schedulingConfig: SchedulingConfig;
  /** Ticks desde a ativação — critério da reciclagem de contexto. */
  tickCount: number;
  /** Valor de `tickCount` na última reciclagem bem-sucedida. */
  lastRecycleTick: number;
  /** Um tick por vez POR PROJETO: dois turnos empilhados no mesmo terminal é o bug que a MT-27 corrigiu. */
  tickRunning: boolean;
  lastSessionCheckAt: string | null;
  /** Rate-limit de reprompt de triagem, por pergunta. */
  promptedAt: Map<string, number>;
  /** Serializa quem mexe no terminal DESTE projeto (reciclagem e restart automático). */
  terminalBusy: boolean;
}

/**
 * Master Agent CLI-only INTERATIVO: uma sessão tmux persistente roda o CLI do
 * usuário com config MCP master. Triagem e chat são prompts colados nesse
 * terminal; o CLI responde chamando as MCP tools answer_question /
 * escalate_question / reply_chat (implementadas no McpServerService).
 * Sem API de LLM e sem one-shot com timeout.
 *
 * MT-20: há um Master POR PROJETO (`runtimes`), e o agendamento saiu daqui —
 * quem dispara o tick é o `ScheduledJob` de tipo `master_tick` executado pelo
 * `SchedulerService`, chamando `runTickForProject`. Não existe mais
 * `setInterval` neste serviço para o agendamento: timer em memória morria no
 * restart e só existia para o projeto ativo, que era a causa raiz #1 da MT-2.
 * O vigia do terminal (`terminalWatchTimer`) é a exceção — continua sendo um
 * `setInterval`, mas agora varre todos os projetos ativos em vez de um só.
 */
@Injectable()
export class MasterAgentService implements OnModuleInit {
  private readonly logger = new Logger(MasterAgentService.name);
  /** Masters ativos, por projeto. Chave presente = Master ativo naquele projeto. */
  private runtimes = new Map<string, MasterProjectRuntime>();
  /**
   * Vigia do terminal (`TERMINAL_WATCH_INTERVAL_MS`): o tmux pode morrer sem
   * nada do orquestrador ter pedido — em 04/08/2026 foi o servidor tmux 3.2a
   * segfaultando (dois coredumps), o que leva TODAS as sessões junto. Sem este
   * timer o Master só descobria no próximo tick (até 15 min depois) e nem
   * assim se recuperava: ficava marcado como ativo, com terminal morto, até um
   * humano clicar em Deactivate/Activate. Armado uma vez em `onModuleInit` — não
   * por projeto, porque com N projetos um timer por Master seria N timers
   * fazendo a mesma varredura.
   */
  private terminalWatchTimer: NodeJS.Timeout | null = null;
  /** Feed global (a UI filtra pelo projeto se quiser) — cada run carrega o seu `projectId`. */
  private activity: MasterActivityRun[] = [];

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private masterRuntime: MasterRuntimeService,
    private projectsService: ProjectsService,
  ) {}

  async onModuleInit() {
    await this.redis.subscribe(CHANNELS.QUESTION_CREATED, (event: QuestionEvent) => {
      if (this.runtimes.size === 0 || !event?.id) return;
      this.logger.log(`Question created: ${event.id} — o tick do projeto vai pegá-la`);
    });

    await this.redis.subscribe(CHANNELS.MASTER_ACTIVITY, (event: MasterActivityEvent) => {
      this.applyActivity(event);
    });

    await this.redis.subscribe(CHANNELS.MASTER_DECISION, (event: any) => {
      if (event?.questionId) {
        this.logger.debug(`Master decision received for question ${event.questionId}`);
      }
    });

    await this.reactivatePersistedMasters();
    // A automação vive em `Project.settings.automation` de CADA projeto, e
    // quem a dispara é o job `master_tick`. Ressincronizar aqui é o que faz a
    // automação de um projeto voltar a valer depois de um restart mesmo que
    // NINGUÉM ative o Master dele — era exatamente o que não acontecia quando
    // o timer vivia em memória e só existia para o projeto ativo.
    await this.syncAllMasterTickJobs();
    // Vigia do terminal: uma vez para o processo inteiro (varre `runtimes`
    // por dentro), não por projeto — ver o comentário de `terminalWatchTimer`.
    this.startTerminalWatch();
  }

  /**
   * Reativa todos os Masters que estavam ativos antes do restart, lendo o SET
   * `MASTER_ACTIVE_PROJECTS_KEY`. Um projeto que falha não impede os outros: o
   * `activate` de cada um é independente (tmux, perfil e token próprios).
   *
   * Também migra, uma vez só, o estado GLOBAL pré-MT-20 (`MASTER_STATE_KEY`):
   * quem atualizou o backend com o Master ligado tem o estado antigo gravado
   * ali e continuaria com o Master "desligado" depois do boot.
   */
  private async reactivatePersistedMasters(): Promise<void> {
    const projectIds = new Set<string>();
    try {
      const legacy = await this.redis.getClient().get(MASTER_STATE_KEY);
      if (legacy) {
        const { projectId } = JSON.parse(legacy) as MasterState;
        if (projectId) {
          projectIds.add(projectId);
          this.logger.log(`Migrando estado global do Master (pré-MT-20) para o projeto ${projectId}`);
        }
        await this.redis.getClient().del(MASTER_STATE_KEY).catch(() => undefined);
      }
      const active = await this.redis.getClient().smembers(MASTER_ACTIVE_PROJECTS_KEY);
      for (const projectId of active) projectIds.add(projectId);
    } catch (error) {
      this.logger.warn(`Falha ao ler o estado persistido do Master: ${error.message}`);
    }

    for (const projectId of projectIds) {
      const state = await this.readPersistedState(projectId);
      try {
        await this.activate({ projectId, cliProfileId: state?.cliProfileId });
        this.logger.log(`Master Agent reativado no projeto ${projectId}`);
      } catch (error) {
        // Projeto deletado, perfil de CLI que sumiu: sai do SET, senão toda
        // subida do backend tentaria reativar o mesmo projeto morto.
        this.logger.warn(`Reativação do Master falhou no projeto ${projectId}: ${error.message}`);
        await this.redis
          .getClient()
          .srem(MASTER_ACTIVE_PROJECTS_KEY, projectId)
          .catch(() => undefined);
      }
    }
  }

  private async readPersistedState(projectId: string): Promise<MasterState | null> {
    try {
      const saved = await this.redis.getClient().get(masterStateKey(projectId));
      return saved ? (JSON.parse(saved) as MasterState) : null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------- resolução de projeto

  /**
   * Projeto alvo de uma chamada que não informou `projectId`. Com um Master só
   * ativo, é ele — é o que mantém as rotas antigas (`POST /triage`,
   * `/session-check`) funcionando sem query param. Com vários, devolve `null`:
   * escolher "o primeiro" mandaria prompt para o projeto errado, que é o modo
   * de falha que esta task existe para fechar.
   */
  private resolveProjectId(projectId?: string | null): string | null {
    if (projectId) return projectId;
    if (this.runtimes.size === 1) return [...this.runtimes.keys()][0];
    return null;
  }

  private runtime(projectId?: string | null): MasterProjectRuntime | null {
    const resolved = this.resolveProjectId(projectId);
    return resolved ? (this.runtimes.get(resolved) ?? null) : null;
  }

  /** Config de automação em memória do projeto, ou o default se ele não tem Master ativo. */
  private configOf(projectId?: string | null): SchedulingConfig {
    return this.runtime(projectId)?.schedulingConfig ?? { ...DEFAULT_SCHEDULING_CONFIG };
  }

  // ------------------------------------------------------------ activation

  /**
   * Ativa o Master DO PROJETO pedido. Sem `projectId` cai no projeto mais antigo
   * (comportamento de antes, para quem chama sem parâmetro). Ativar o projeto B
   * não desliga o Master do projeto A — cada um tem tmux, token e estado
   * próprios (MT-20).
   */
  async activate(dto: { projectId?: string; cliProfileId?: string } = {}) {
    const project = dto.projectId
      ? await this.prisma.project.findUnique({ where: { id: dto.projectId } })
      : await this.prisma.project.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!project) {
      throw new NotFoundException(
        'No project found — create a project before activating the Master Agent',
      );
    }

    const existing = this.runtimes.get(project.id);
    if (existing) {
      const activeProfile = await this.prisma.cliProfile.findUnique({
        where: { id: existing.cliProfileId },
      });
      return {
        success: true,
        alreadyActive: true,
        projectId: project.id,
        cliProfile: activeProfile?.name ?? null,
      };
    }

    const profile = await this.resolveProfile(project.id, dto.cliProfileId);
    if (!profile) {
      throw new NotFoundException('No CLI profile found — seed or create a CliProfile first');
    }
    const { model: masterModel, provenance } = await this.resolveMasterModel(project.id, profile);
    const { permissionMode, provenance: permissionProvenance } =
      await this.resolveMasterPermissionMode(project.id);

    // Se o terminal do Master ainda está vivo, o CLI dele carregou o token do
    // mcp config no boot — gerar um novo aqui invalidaria a conexão (401 no
    // /mcp até reiniciar o CLI). Reusa o token persistido nesse caso; token
    // novo só quando o terminal vai ser (re)criado.
    let token: string = randomUUID();
    if (await this.masterRuntime.isRunning(project.id)) {
      const saved = await this.readPersistedState(project.id);
      if (saved?.token) token = saved.token;
    }
    await this.masterRuntime.start(project, profile, token, masterModel, permissionMode);

    this.runtimes.set(project.id, {
      projectId: project.id,
      cliProfileId: profile.id,
      mcpToken: token,
      schedulingConfig: { ...DEFAULT_SCHEDULING_CONFIG },
      tickCount: 0,
      lastRecycleTick: 0,
      tickRunning: false,
      lastSessionCheckAt: null,
      promptedAt: new Map(),
      terminalBusy: false,
    });

    await this.persistState(project.id, profile.id, token);

    // `await` obrigatório: carrega a config de automação do projeto e garante
    // que o job `master_tick` existe com a cadência dela ANTES de responder.
    // Sem isso o `activate` devolvia `success: true` e um `GET
    // /master-agent/scheduling` na sequência via o Master como "sem timer".
    await this.reloadScheduling(project.id);

    await this.prisma.logEntry.create({
      data: {
        projectId: project.id,
        level: 'info',
        message: `Master Agent activated (project=${project.name}, cli=${profile.name}, ${provenance}, ${permissionProvenance}, interactive terminal)`,
      },
    });

    return { success: true, projectId: project.id, cliProfile: profile.name };
  }

  /**
   * Desliga o Master de UM projeto. Sem `projectId`, só resolve sozinho quando
   * há exatamente um ativo — com dois, desligar "o primeiro" mataria o terminal
   * de quem não pediu nada. O vigia do terminal não é desarmado aqui — é
   * global (varre `runtimes`), não por projeto; sem entrada no mapa ele
   * simplesmente ignora este projeto na próxima varredura.
   */
  async deactivate(projectId?: string) {
    const target = this.resolveProjectId(projectId);
    if (!target || !this.runtimes.has(target)) {
      return { success: false, reason: 'Master Agent is not active' };
    }

    this.runtimes.delete(target);
    await this.masterRuntime.stop(target);
    await this.clearPersistedState(target);
    await this.prisma.logEntry.create({
      data: { projectId: target, level: 'info', message: 'Master Agent deactivated' },
    });
    // O agendamento NÃO é desfeito aqui: a automação é do projeto, não do
    // terminal. O job `master_tick` continua existindo e, sem Master de pé,
    // roda só a parte de backend do tick registrando o motivo (MT-20).
    return { success: true, projectId: target };
  }

  /**
   * Status do Master de um projeto (default: o único ativo, se houver) + a lista
   * de TODOS os projetos com Master ativo. A lista existe porque, com N Masters,
   * a página de um projeto não pode mais afirmar "o Master está desligado" só
   * porque não é ela que está ativa.
   */
  async getStatus(projectId?: string) {
    const target = this.resolveProjectId(projectId);
    const runtime = target ? this.runtimes.get(target) : null;
    const [project, profile, tmuxRunning, activeProjects] = await Promise.all([
      target
        ? this.prisma.project.findUnique({ where: { id: target }, select: { name: true } })
        : null,
      runtime
        ? this.prisma.cliProfile.findUnique({
            where: { id: runtime.cliProfileId },
            select: { name: true },
          })
        : null,
      target ? this.masterRuntime.isRunning(target) : false,
      this.listActiveProjects(),
    ]);
    const lastRun = [...this.activity]
      .reverse()
      .find((run) => !target || !run.projectId || run.projectId === target);
    return {
      isActive: !!runtime,
      projectId: target,
      cliProfileId: runtime?.cliProfileId ?? null,
      projectName: project?.name ?? null,
      cliProfileName: profile?.name ?? null,
      tmuxRunning,
      lastActivity: lastRun ? (lastRun.endedAt ?? lastRun.startedAt) : null,
      activeProjects,
    };
  }

  /** Todos os Masters ativos agora — usado pela UI e pelo `handleMasterLoop`. */
  async listActiveProjects(): Promise<
    Array<{ projectId: string; projectName: string; tmuxRunning: boolean }>
  > {
    const ids = [...this.runtimes.keys()];
    if (ids.length === 0) return [];
    const projects = await this.prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const names = new Map(projects.map((p) => [p.id, p.name]));
    return Promise.all(
      ids.map(async (projectId) => ({
        projectId,
        projectName: names.get(projectId) ?? projectId,
        tmuxRunning: await this.masterRuntime.isRunning(projectId),
      })),
    );
  }

  /**
   * Grava o estado do Master do projeto + o índice token → projeto, que é como
   * o `/mcp` descobre de qual Master é o Bearer token recebido.
   */
  private async persistState(projectId: string, cliProfileId: string, token: string) {
    const state: MasterState = { projectId, cliProfileId, token };
    await Promise.all([
      this.redis.getClient().set(masterStateKey(projectId), JSON.stringify(state)),
      this.redis.getClient().set(masterTokenIndexKey(token), projectId),
      this.redis.getClient().sadd(MASTER_ACTIVE_PROJECTS_KEY, projectId),
    ]).catch((error) => this.logger.warn(`Failed to persist master state: ${error.message}`));
  }

  private async clearPersistedState(projectId: string) {
    const state = await this.readPersistedState(projectId);
    await Promise.all([
      this.redis.getClient().del(masterStateKey(projectId)),
      state?.token
        ? this.redis.getClient().del(masterTokenIndexKey(state.token))
        : Promise.resolve(0),
      this.redis.getClient().srem(MASTER_ACTIVE_PROJECTS_KEY, projectId),
    ]).catch((error) => this.logger.warn(`Failed to clear master state: ${error.message}`));
  }

  // ------------------------------------------------------------ scheduling

  async triggerManualTriage(
    projectId?: string,
  ): Promise<{ triggered: boolean; questionCount: number }> {
    const runtime = this.runtime(projectId);
    if (!runtime) return { triggered: false, questionCount: 0 };

    // Só as perguntas DAQUELE projeto: com N Masters, uma varredura global
    // mandaria a pergunta do projeto A para o terminal de todos os outros.
    const pendingQuestions = await this.prisma.question.findMany({
      where: { status: 'pending', session: { macroTask: { projectId: runtime.projectId } } },
      select: { id: true },
    });

    let count = 0;
    for (const q of pendingQuestions) {
      const lastPrompt = runtime.promptedAt.get(q.id);
      if (lastPrompt && Date.now() - lastPrompt < runtime.schedulingConfig.repromptAfterMs) continue;
      void this.promptTriage(q.id).catch((error) =>
        this.logger.error(`Manual triage prompt failed for ${q.id}: ${error.message}`),
      );
      count++;
    }

    return { triggered: true, questionCount: count };
  }

  /**
   * Config efetiva de um projeto. Funciona com o Master desligado: o usuário
   * pode olhar/editar a automação antes de ativar, então a leitura não
   * depende de `isActive` — só do projeto pedido (default: o ativo, se houver).
   */
  async getSchedulingConfig(
    projectId?: string,
  ): Promise<
    SchedulingConfig & {
      lastSessionCheckAt: string | null;
      nextTick: string | null;
      /** Master daquele projeto de pé? A UI usa para explicar um tick parcial. */
      masterActive: boolean;
    }
  > {
    const targetProjectId = this.resolveProjectId(projectId);
    if (!targetProjectId) {
      return {
        ...DEFAULT_SCHEDULING_CONFIG,
        lastSessionCheckAt: null,
        nextTick: null,
        masterActive: false,
      };
    }

    const runtime = this.runtimes.get(targetProjectId);
    const config =
      runtime?.schedulingConfig ??
      (await loadSchedulingConfigFromStore(this.prisma, this.redis, targetProjectId));

    // MT-20 (item 3): o próximo disparo vem do job no banco, não de um
    // `timersArmedAt` em memória. Antes só existia para o projeto ativo do
    // Master, e a UI de qualquer outro projeto mostrava vazio — que o usuário
    // lia como "não há automação".
    return {
      ...config,
      lastSessionCheckAt: runtime?.lastSessionCheckAt ?? null,
      nextTick: await readNextTickAt(this.prisma.scheduledJob, targetProjectId),
      masterActive: !!runtime,
    };
  }

  /**
   * Save idempotente (MT-2): valor igual ao já persistido não escreve nem
   * reagenda nada (`changed: false`). Valor novo grava em
   * `Project.settings.automation` (a verdade) e sincroniza o job `master_tick`
   * do projeto — independente de o Master daquele projeto estar de pé ou não,
   * que é o ponto da MT-20: a automação é do PROJETO, não do terminal.
   */
  async updateSchedulingConfig(
    projectId: string,
    patch: Partial<SchedulingConfig>,
  ): Promise<{
    config: SchedulingConfig;
    changed: boolean;
    lastSessionCheckAt: string | null;
    nextTick: string | null;
  }> {
    assertValidSchedulingPatch(patch);

    const runtime = this.runtimes.get(projectId);
    const current =
      runtime?.schedulingConfig ??
      (await loadSchedulingConfigFromStore(this.prisma, this.redis, projectId));
    const next = applySchedulingPatch(current, patch);
    const changed = !schedulingConfigsEqual(current, next);

    if (changed) {
      await persistSchedulingConfigToStore(this.prisma, this.redis, projectId, next);
    }
    if (runtime) runtime.schedulingConfig = next;

    // Sync sempre, não só quando `changed`: o job pode não existir ainda (config
    // gravada por uma versão anterior, ou job apagado à mão) e um save sem
    // mudança é justamente a ação com que o usuário tenta "religar" a automação.
    const { scheduledAt } = await syncMasterTickJob(this.prisma.scheduledJob, projectId, next);

    return {
      config: next,
      changed,
      lastSessionCheckAt: runtime?.lastSessionCheckAt ?? null,
      nextTick: scheduledAt,
    };
  }

  /**
   * Recarrega a config PERSISTIDA do projeto para a memória e garante que o job
   * `master_tick` reflete a cadência dela. Substituiu o `startTimers`: não há
   * mais `setInterval` aqui — quem dispara o tick é o `SchedulerService`, pelo
   * job. Ler do banco (e não confiar no que está em memória) é o que faz uma
   * config salva com o Master desligado valer na ativação seguinte.
   */
  private async reloadScheduling(projectId: string): Promise<void> {
    const config = await loadSchedulingConfigFromStore(this.prisma, this.redis, projectId);
    const runtime = this.runtimes.get(projectId);
    if (runtime) runtime.schedulingConfig = config;
    await syncMasterTickJob(this.prisma.scheduledJob, projectId, config);
  }

  /**
   * Sincroniza o job de tick de TODOS os projetos que têm automação gravada.
   * É o que conserta a causa raiz #1 da MT-2: a automação de um projeto passa a
   * valer depois de um restart mesmo que o Master dele nunca tenha sido ativado
   * nesta subida — antes, só o projeto ativo recarregava a config.
   */
  private async syncAllMasterTickJobs(): Promise<void> {
    const projects = await this.prisma.project.findMany({ select: { id: true, settings: true } });
    for (const project of projects) {
      const settings = (project.settings as Record<string, unknown> | null) ?? {};
      // Projeto que nunca salvou automação não ganha job: criar um para todos
      // ligaria o tick em quem nunca pediu (os defaults têm triagem e
      // health-check ativos).
      if (settings[AUTOMATION_SETTINGS_KEY] === undefined) continue;
      try {
        const config = await loadSchedulingConfigFromStore(this.prisma, this.redis, project.id);
        const { scheduledAt, action } = await syncMasterTickJob(
          this.prisma.scheduledJob,
          project.id,
          config,
        );
        if (action !== 'kept' && action !== 'none') {
          this.logger.log(
            `Automação do projeto ${project.id}: job de tick ${action}${scheduledAt ? ` — próximo às ${scheduledAt}` : ''}`,
          );
        }
      } catch (error) {
        this.logger.warn(`Falha ao sincronizar o tick do projeto ${project.id}: ${error.message}`);
      }
    }
  }

  // ------------------------------------------------- vigia do terminal

  /**
   * Arma o vigia do terminal — uma vez para o processo inteiro (MT-20), não por
   * projeto: a cada disparo, varre TODOS os projetos com Master ativo agora
   * (`runtimes` muda com `activate`/`deactivate`, então a lista é lida a cada
   * tick do vigia, nunca capturada uma vez só). Independente do timer do tick
   * de propósito: um projeto com todas as automações desligadas não arma tick
   * nenhum (`computeTickIntervalMinutes` devolve `null`) e continuaria com o
   * Master "ativo" e o terminal morto para sempre — e é justamente nesse
   * projeto que o chat é o único uso do Master, o caso em que o terminal morto
   * mais dói.
   */
  private startTerminalWatch() {
    this.stopTerminalWatch();
    this.terminalWatchTimer = setInterval(() => {
      for (const projectId of this.runtimes.keys()) {
        void this.ensureTerminal(projectId, 'watchdog').catch((error) =>
          this.logger.error(`Master terminal watchdog falhou (projeto ${projectId}): ${error.message}`),
        );
      }
    }, TERMINAL_WATCH_INTERVAL_MS);
    // Sem unref o timer segura o event loop nos testes/shutdown.
    this.terminalWatchTimer.unref?.();
  }

  private stopTerminalWatch() {
    if (this.terminalWatchTimer) {
      clearInterval(this.terminalWatchTimer);
      this.terminalWatchTimer = null;
    }
  }

  /**
   * Garante que existe terminal vivo para o Master do projeto — e o resobe
   * quando não existe. Devolve `true` só quando o terminal JÁ estava de pé:
   * quem chama não deve colar prompt no CLI que acabou de nascer (ele ainda
   * está bootando, e o paste viraria texto perdido no shell).
   *
   * O token é o MESMO (`runtime.mcpToken`): o mcp config já está escrito no
   * workdir e o CLI novo o relê no boot, então a conexão MCP volta válida —
   * mesma razão pela qual a reciclagem de contexto (MT-27) reusa o token.
   *
   * O restart é registrado com nível `error` em `log_entries`: o terminal morrer
   * sozinho não é rotina, é incidente — e é o que a página de Logs precisa
   * mostrar para o crash do tmux deixar de ser invisível.
   */
  private async ensureTerminal(
    projectId: string,
    reason: 'watchdog' | 'tick' | 'chat',
  ): Promise<boolean> {
    const runtime = this.runtimes.get(projectId);
    if (!runtime) return false;
    if (await this.masterRuntime.isRunning(projectId)) return true;
    // Reciclagem (ou outro restart) em andamento: a janela entre o `stop` e o
    // `start` dela é exatamente este "não está rodando". Subir um segundo
    // terminal aqui só criaria erro de sessão tmux duplicada.
    if (runtime.terminalBusy) return false;

    runtime.terminalBusy = true;
    try {
      const [project, profile] = await Promise.all([
        this.prisma.project.findUnique({ where: { id: runtime.projectId } }),
        this.prisma.cliProfile.findUnique({ where: { id: runtime.cliProfileId } }),
      ]);
      if (!project || !profile) return false;

      const { model } = await this.resolveMasterModel(project.id, profile);
      const { permissionMode } = await this.resolveMasterPermissionMode(project.id);
      await this.masterRuntime.start(project, profile, runtime.mcpToken, model, permissionMode);
      // Contexto novo: o cache de rate-limit da triagem não vale mais (mesmo
      // motivo da reciclagem), senão o terminal novo nunca reveria perguntas
      // que o anterior tinha visto.
      runtime.promptedAt.clear();
      this.logger.warn(
        `Master Agent terminal was gone (${reason}, projeto ${projectId}) — restarted automatically`,
      );
      await this.prisma.logEntry.create({
        data: {
          projectId: runtime.projectId,
          level: 'error',
          message:
            'Master Agent terminal died (tmux session gone) and was restarted automatically — the CLI conversation context was lost',
          metadata: { kind: 'master-terminal-restart', reason },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to restart the Master Agent terminal (projeto ${projectId}): ${error.message}`);
    } finally {
      runtime.terminalBusy = false;
    }
    return false;
  }

  // ------------------------------------------------------------ feed

  /** Snapshot do feed de atividade (para a UI hidratar antes do SSE). */
  getActivity(): MasterActivityRun[] {
    return this.activity;
  }

  /** Aplica um evento master:activity ao ring buffer (local ou vindo do MCP). */
  private applyActivity(event: MasterActivityEvent) {
    if (!event?.runId || !event.phase) return;
    if (event.phase === 'start') {
      if (this.activity.some((r) => r.runId === event.runId)) return;
      this.activity.push({
        runId: event.runId,
        projectId: event.projectId,
        kind: event.kind,
        questionId: event.questionId,
        promptPreview: event.promptPreview || '',
        startedAt: event.ts,
        output: '',
      });
      if (this.activity.length > MAX_ACTIVITY_RUNS) {
        this.activity.splice(0, this.activity.length - MAX_ACTIVITY_RUNS);
      }
      return;
    }
    let run = this.activity.find((r) => r.runId === event.runId);
    if (!run && event.phase === 'end') {
      // end sem start (ex.: restart entre o prompt e a resposta) — cria o run
      run = {
        runId: event.runId,
        projectId: event.projectId,
        kind: event.kind,
        questionId: event.questionId,
        promptPreview: event.promptPreview || '',
        startedAt: event.ts,
        output: '',
      };
      this.activity.push(run);
    }
    if (!run) return;
    if (event.phase === 'chunk' && event.chunk) {
      run.output = (run.output + event.chunk).slice(-MAX_RUN_OUTPUT);
    } else if (event.phase === 'end') {
      run.endedAt = event.ts;
      run.exitCode = event.exitCode;
      run.result = event.result;
      run.action = event.action;
      run.error = event.error;
    }
  }

  private publishActivity(event: MasterActivityEvent) {
    void this.redis
      .publish(CHANNELS.MASTER_ACTIVITY, event)
      .catch((error) => this.logger.warn(`Failed to publish master activity: ${error.message}`));
  }

  // ------------------------------------------------------------ triage

  private async resolveProfile(projectId: string | null, cliProfileId?: string) {
    if (cliProfileId) {
      return this.prisma.cliProfile.findUnique({ where: { id: cliProfileId } });
    }
    if (projectId) {
      const settingsProfile = await this.projectsService.getSetting(projectId, 'masterAgentProfile')
        || await this.projectsService.getSetting(projectId, 'defaultCliProfile');
      if (settingsProfile) {
        const bySettings = await this.prisma.cliProfile.findUnique({ where: { name: settingsProfile } });
        if (bySettings) return bySettings;
      }
    }
    const preferred = process.env.MASTER_AGENT_PROFILE;
    if (preferred) {
      const byName = await this.prisma.cliProfile.findUnique({ where: { name: preferred } });
      if (byName) return byName;
    }
    const defaultProfile = await this.prisma.cliProfile.findFirst({ where: { isDefault: true } });
    if (defaultProfile) return defaultProfile;
    return (
      (await this.prisma.cliProfile.findUnique({ where: { name: 'claude' } })) ||
      (await this.prisma.cliProfile.findFirst())
    );
  }

  /**
   * Modo de permissão do CLI do Master: `project.settings.defaults.permissionMode`
   * (o mesmo campo que as sessões usam), com o MESMO fallback delas
   * (`acceptEdits`).
   *
   * Fallback e não "sem flag": sem `--permission-mode` o CLI sobe no modo
   * default e pede confirmação a cada tool call. Num terminal que ninguém está
   * olhando isso não é "mais seguro", é o Master parado esperando um "yes" que
   * nunca vem — que é como o modo auto pedido nas settings parecia não pegar.
   */
  private async resolveMasterPermissionMode(
    projectId: string,
  ): Promise<{ permissionMode: string; provenance: string }> {
    const defaults = await this.projectsService.getDefaults(projectId);
    if (defaults.permissionMode) {
      return {
        permissionMode: defaults.permissionMode,
        provenance: `permissionMode=${defaults.permissionMode} (projectDefaults)`,
      };
    }
    return { permissionMode: 'acceptEdits', provenance: 'permissionMode=acceptEdits (default)' };
  }

  /**
   * Modelo do Master, independente do das sessões. Precedência:
   * `project.settings.defaults.masterModel` > `cliProfile.defaultModel`.
   * `masterModel` não entra em `projectDefaultsToConfigLayer` (é a camada das
   * SESSÕES) — aqui montamos a camada `projectDefaults` manualmente com o
   * campo certo, e resolvemos com o mesmo `resolveRuntimeConfig` para ganhar
   * o `describeProvenance` de graça no log de ativação.
   */
  private async resolveMasterModel(
    projectId: string,
    profile: { defaultModel: string | null },
  ): Promise<{ model?: string; provenance: string }> {
    const defaults = await this.projectsService.getDefaults(projectId);
    const resolution = resolveRuntimeConfig({
      projectDefaults: { model: defaults.masterModel },
    });
    if (resolution.config.model) {
      return { model: resolution.config.model, provenance: describeProvenance(resolution) };
    }
    if (profile.defaultModel) {
      return {
        model: profile.defaultModel,
        provenance: `model=${profile.defaultModel} (cliProfile.defaultModel)`,
      };
    }
    return { model: undefined, provenance: 'model=(nenhum — CLI usa o default próprio)' };
  }

  // -------------------------------------------------------------- tick único

  /**
   * Tick único do Master (MT-27). Antes eram três `setInterval` colando três
   * prompts SEPARADOS no mesmo terminal persistente: três turnos por ciclo,
   * cada um recarregando o estado que o anterior tinha acabado de ler. Agora
   * uma passada só junta num prompt único as partes habilitadas — e, desde a
   * MT-28, TODA parte habilitada entra em TODO tick: não há mais intervalo por
   * parte nem vencimento a conferir, só o liga-desliga de cada uma.
   *
   * Ordem importa: a reciclagem vem antes de montar o prompt (reciclar depois
   * jogaria fora o turno que acabou de ser pedido), e o auto-start vem antes
   * do prompt porque muda o retrato de sessões que o Master vai ler.
   *
   * MT-20: quem chama é o `SchedulerService`, executando o job `master_tick`
   * daquele projeto — daí ser público e receber `projectId`. As partes são
   * divididas em duas categorias, e essa divisão é o que faz a automação valer
   * para N projetos: o **auto-start** é trabalho de backend e roda sem terminal
   * nenhum; triagem, health-check e report precisam do CLI do Master DAQUELE
   * projeto e, sem ele, são reportadas como não executadas (`deferred`) em vez
   * de cancelarem o tick inteiro.
   */
  async runTickForProject(projectId: string): Promise<{
    ran: string[];
    skipped?: string;
    deferred?: string;
  }> {
    const config = this.runtimes.get(projectId)?.schedulingConfig
      ?? (await loadSchedulingConfigFromStore(this.prisma, this.redis, projectId));
    const ran: string[] = [];

    // Auto-start primeiro: não depende de terminal e muda o retrato de sessões
    // que o Master vai ler no prompt logo abaixo.
    if (config.autoStartEnabled) {
      await this.autoStartNextTasks(projectId, config.autoStartMaxPerTick).catch((error) =>
        this.logger.error(`Auto-start falhou no projeto ${projectId}: ${error.message}`),
      );
      ran.push('auto-start');
    }

    const runtime = this.runtimes.get(projectId);
    if (!runtime) {
      return { ran, deferred: 'Master Agent não está ativo neste projeto — ative-o no dashboard' };
    }
    if (runtime.tickRunning) {
      this.logger.warn(`Tick anterior do projeto ${projectId} ainda em andamento — pulando`);
      return { ran, skipped: 'tick anterior ainda em andamento' };
    }
    // Terminal morto com o Master ainda marcado como ativo: sem esta guarda o
    // tick consumiria o estado (marca `promptedAt`, gasta a tentativa de
    // merge-conflict, conta o tick da reciclagem) e só então descobriria, no
    // `sendPrompt`, que não há para onde mandar.
    //
    // `ensureTerminal` resobe o terminal quando ele morreu (tmux caiu sozinho) e
    // devolve `false` nesse caso — o prompt deste tick fica para o próximo, com
    // o CLI novo já bootado, em vez de ser colado num CLI meio de pé.
    if (!(await this.ensureTerminal(projectId, 'tick'))) {
      return { ran, deferred: 'Terminal do Master não está rodando' };
    }

    runtime.tickRunning = true;
    try {
      runtime.tickCount++;
      await this.maybeRecycleContext(runtime);

      const runId = `tick:${randomUUID().slice(0, 8)}`;
      const sections: string[] = [];
      let includesReport = false;

      if (config.autoTriageEnabled) {
        const triage = await this.buildTriageSection(runtime);
        if (triage) sections.push(triage);
        ran.push('triagem');
      }
      if (config.sessionCheckEnabled) {
        const health = await this.collectSessionHealth(runtime);
        if (health.section) sections.push(health.section);
        ran.push('health-check');
      }
      if (config.statusReportEnabled) {
        sections.push(await this.buildStatusReportSection(runtime, runId));
        includesReport = true;
        ran.push('status report');
      }

      if (sections.length === 0) return { ran };

      this.publishActivity({
        runId,
        projectId,
        // O fim do report volta pelo reply_chat, que reusa este runId com
        // kind 'chat' — anunciar outro kind aqui partiria o run no feed.
        kind: includesReport ? 'chat' : 'health',
        phase: 'start',
        ts: new Date().toISOString(),
        promptPreview: `Master tick — ${sections.length} part(s)`,
      });
      await this.masterRuntime.sendPrompt(
        projectId,
        `[ORCHESTRATOR TICK ${runId}] Periodic orchestrator pass. Handle EVERY numbered block below in this same turn, using ONLY the orchestrator MCP tools. Do NOT reply in the terminal — only tool calls count.\n\n${sections
          .map((section, index) => `### ${index + 1}. ${section}`)
          .join('\n\n')}`,
      );
      return { ran };
    } finally {
      runtime.tickRunning = false;
    }
  }

  /**
   * Pede ao governor que suba a próxima macro task pendente do projeto.
   * Via evento porque `SchedulerModule` já importa `MasterAgentModule`: chamar
   * o `SessionGovernorService` daqui fecharia um ciclo de importação, e o tick
   * não precisa do resultado — quem decide teto e enfileiramento é o governor.
   */
  private async autoStartNextTasks(projectId: string, max: number): Promise<void> {
    await this.redis.publish(CHANNELS.MASTER_AUTOSTART, { projectId, max });
  }

  /**
   * Recicla o terminal do Master a cada N ticks (MT-27): o CLI é interativo e
   * persistente, então triagem, health, report e chat se acumulam na MESMA
   * conversa — depois de algumas horas cada tick custa muito mais token.
   *
   * Derruba e resobe a tmux em vez de mandar `/clear`: o comando de limpar
   * contexto é específico de cada CLI (o `/clear` é do Claude Code) e num
   * perfil diferente viraria texto colado na conversa. `stop`+`start` já
   * existem e funcionam para qualquer binário. Nada se perde: o estado do
   * Master vive no banco, e o único cache em memória é o `promptedAt` do
   * rate-limit de triagem, que é reconstruído no tick seguinte.
   */
  private async maybeRecycleContext(runtime: MasterProjectRuntime): Promise<void> {
    const { contextRecycleEnabled, contextRecycleAfterTicks } = runtime.schedulingConfig;
    if (!contextRecycleEnabled) return;
    // Distância desde a última reciclagem, e não `tickCount % N`: com o módulo,
    // uma reciclagem adiada por turno em andamento só voltaria a ser tentada N
    // ticks depois, em vez de no tick seguinte.
    if (runtime.tickCount - runtime.lastRecycleTick < contextRecycleAfterTicks) return;

    // Turno em andamento = run aberto no feed DESTE projeto. Reciclar agora
    // mataria o CLI no meio de uma resposta; espera o próximo tick.
    const openRun = this.activity.some(
      (run) => !run.endedAt && (!run.projectId || run.projectId === runtime.projectId),
    );
    if (openRun) {
      this.logger.log('Reciclagem de contexto adiada — há um turno do Master em andamento');
      return;
    }

    const [project, profile] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: runtime.projectId } }),
      this.prisma.cliProfile.findUnique({ where: { id: runtime.cliProfileId } }),
    ]);
    if (!project || !profile) return;

    const { model } = await this.resolveMasterModel(project.id, profile);
    const { permissionMode } = await this.resolveMasterPermissionMode(project.id);
    // `terminalBusy` fecha a janela entre o `stop` e o `start` da reciclagem: é
    // um instante em que `isRunning()` responde false, e sem isto o vigia
    // (`ensureTerminal`) tentaria subir um segundo terminal no meio dela.
    runtime.terminalBusy = true;
    try {
      await this.masterRuntime.recycle(project, profile, runtime.mcpToken, model, permissionMode);
    } catch (error) {
      // A tmux já pode ter morrido no `stop` — deixar a exceção subir mataria o
      // tick inteiro e esconderia o motivo. O tick seguinte pula sozinho pela
      // guarda de `isRunning`, e este log é o que explica por quê.
      this.logger.error(`Falha ao reciclar o terminal do Master: ${error.message}`);
      return;
    } finally {
      runtime.terminalBusy = false;
    }
    runtime.lastRecycleTick = runtime.tickCount;
    // Cache de rate-limit não sobrevive ao reset do contexto: sem isso o
    // terminal novo não seria lembrado de perguntas que o anterior já viu, mas
    // também nunca as reveria dentro do `repromptAfterMs`.
    runtime.promptedAt.clear();
    await this.prisma.logEntry.create({
      data: {
        projectId: runtime.projectId,
        level: 'info',
        message: `Master Agent context recycled after ${contextRecycleAfterTicks} ticks (terminal restarted)`,
        metadata: { tickCount: runtime.tickCount },
      },
    });
  }

  /**
   * Perguntas pendentes que o Master ainda não viu (ou já pode rever, passado
   * o `repromptAfterMs`) viram UM bloco do prompt do tick, em vez de um prompt
   * por pergunta. `promptTriage` continua existindo para o caminho avulso
   * (`POST /triage`) e é quem aplica as regras de escalonamento.
   */
  private async buildTriageSection(runtime: MasterProjectRuntime): Promise<string | null> {
    // Escopado no projeto: o Master de um projeto não tria pergunta de outro —
    // ele nem tem as tools apontadas para lá (a identidade é o token dele).
    const pendingQuestions = await this.prisma.question.findMany({
      where: { status: 'pending', session: { macroTask: { projectId: runtime.projectId } } },
      select: { id: true },
    });

    const blocks: string[] = [];
    for (const q of pendingQuestions) {
      const block = await this.prepareTriage(q.id);
      if (block) blocks.push(block);
    }
    if (blocks.length === 0) return null;
    return `TRIAGE — ${blocks.length} pending question(s). Resolve each one:\n\n${blocks.join('\n\n')}`;
  }

  /** Retrato das sessões + bloco de health para o prompt do tick. */
  private async buildStatusReportSection(
    runtime: MasterProjectRuntime,
    runId: string,
  ): Promise<string> {
    // Relatório não tem mensagem de usuário que defina a conversa: cai na
    // conversa ativa (ou na mais recente do projeto), nunca solto sem conversa.
    await this.redis
      .getClient()
      .set(MASTER_CHAT_RUN_KEY, runId, 'EX', 3600)
      .catch(() => undefined);
    await this.ensureActiveChatSession(runtime.projectId);
    const stats = await this.collectStats(runtime.projectId);
    await this.prisma.logEntry.create({
      data: {
        projectId: runtime.projectId,
        level: 'info',
        message: 'Master Agent scheduled status report requested',
        metadata: { runId },
      },
    });
    return this.buildStatusReportPrompt(stats);
  }

  private buildStatusReportPrompt(stats: unknown): string {
    return `STATUS REPORT. Investigate the current state using the orchestrator MCP tools (get_status, list_sessions, list_pending_questions, list_macro_tasks) and post a CONCISE status report by calling reply_chat: active sessions and what each is doing, stalled/failed work, pending questions needing the human, and 1-2 suggested next steps. Plain text, short lines. Live snapshot: ${JSON.stringify(stats)}`;
  }

  // ------------------------------------------------------- session health

  /**
   * Health-check avulso (`POST /session-check`): coleta e manda o prompt na
   * hora. O caminho periódico não passa mais por aqui — ele usa
   * `collectSessionHealth` e junta o bloco no prompt único do tick.
   */
  async checkSessionsHealth(
    force = false,
    projectId?: string,
  ): Promise<{
    checked: number;
    stalled: number;
    prompted: boolean;
  }> {
    const runtime = this.runtime(projectId);
    if (!runtime) return { checked: 0, stalled: 0, prompted: false };
    if (!force && !runtime.schedulingConfig.sessionCheckEnabled) {
      return { checked: 0, stalled: 0, prompted: false };
    }

    const health = await this.collectSessionHealth(runtime, force);
    if (!health.section) {
      return { checked: health.checked, stalled: health.stalled, prompted: false };
    }

    const runId = `health:${randomUUID().slice(0, 8)}`;
    this.publishActivity({
      runId,
      projectId: runtime.projectId,
      kind: 'health',
      phase: 'start',
      ts: new Date().toISOString(),
      promptPreview: `Session health check — ${health.checked} active, ${health.stalled} stalled`,
    });
    await this.masterRuntime.sendPrompt(
      runtime.projectId,
      `[ORCHESTRATOR HEALTH CHECK ${runId}] Periodic session health check. Use ONLY the orchestrator MCP tools. Do NOT reply in the terminal.\n\n${health.section}`,
    );

    return { checked: health.checked, stalled: health.stalled, prompted: true };
  }

  /**
   * Coleta as sessões ativas, publica `session:stalled` para a UI e devolve o
   * bloco de health do prompt (ou `null`, quando não há o que o Master faça).
   *
   * MT-27: sessão `paused` NÃO é mais excluída da avaliação. Ela era buscada
   * no banco e descartada logo depois, então uma sessão parada por conflito de
   * merge ou por pergunta pendente ficava invisível para o Master — que, além
   * disso, não tinha ferramenta para destravá-la.
   *
   * MT-23: o Master não tem mais relógio próprio. "Travada" é `stalledAt`
   * gravado pelo watchdog do `session-runtime.service.ts`, que é o único
   * detector e olha a atividade real do pane (`tmux window_activity`/
   * `LogEntry`). Antes daqui se comparava `updatedAt` com
   * `stalledAfterMinutes`, e `updatedAt` é `@updatedAt`: qualquer escrita na
   * sessão — o `pid` do reattach, o `_watchdog` do próprio watchdog — o
   * empurrava para "agora", então o Master podia declarar viva uma sessão
   * morta. O publish de `session:stalled` por relógio também saiu: quem marca
   * já publica, e dois produtores davam dois alarmes divergentes para o mesmo
   * fato. `paused` continua entrando na hora e continua publicando — não é
   * detecção, é leitura de status, e pausa não se resolve com o tempo.
   */
  private async collectSessionHealth(
    runtime: MasterProjectRuntime,
    force = false,
  ): Promise<{
    section: string | null;
    checked: number;
    stalled: number;
  }> {
    const activeSessions = await this.prisma.session.findMany({
      // Só as sessões do projeto deste Master: as tools dele (stop_session,
      // resume_session) são escopadas no projeto do token, então mandar sessão
      // de outro projeto no prompt seria pedir uma ação que ele não consegue
      // executar.
      where: {
        status: { in: ['running', 'waiting', 'paused'] },
        macroTask: { projectId: runtime.projectId },
      },
      select: {
        id: true,
        status: true,
        currentStage: true,
        updatedAt: true,
        stalledAt: true,
        stageData: true,
        macroTask: { select: { title: true, project: { select: { name: true } } } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    });
    runtime.lastSessionCheckAt = new Date().toISOString();

    const stalled = activeSessions.filter((s) => s.status === 'paused' || !!s.stalledAt);

    for (const session of stalled) {
      this.logger.warn(
        `Stalled session: ${session.id} (${session.macroTask?.title || 'unknown'}) — status ${session.status}, stalled since ${session.stalledAt?.toISOString() ?? 'n/a (paused)'}`,
      );
      // Só o `paused` publica: a travada de verdade já foi anunciada pelo
      // watchdog no momento em que gravou `stalledAt`, com muito mais contexto
      // (motivo, origem do sinal, reprompts gastos).
      if (session.status !== 'paused') continue;
      await this.redis
        .publish(CHANNELS.SESSION_STALLED, {
          sessionId: session.id,
          status: session.status,
          lastUpdateAt: session.updatedAt.toISOString(),
          reason: 'Session is paused and needs an explicit resume',
        })
        .catch(() => undefined);
    }

    if (activeSessions.length === 0) return { section: null, checked: 0, stalled: 0 };
    // Sem sessão travada e sem force: não gasta um turno do Master à toa.
    if (stalled.length === 0 && !force) {
      return { section: null, checked: activeSessions.length, stalled: 0 };
    }

    if (stalled.length > 0) {
      await this.prisma.logEntry.create({
        data: {
          projectId: runtime.projectId,
          level: 'warn',
          message: `Master Agent health check: ${stalled.length} stalled/paused session(s) sent for inspection`,
          metadata: { stalledIds: stalled.map((s) => s.id) },
        },
      });
    }

    return {
      section: this.buildHealthSection(activeSessions, stalled),
      checked: activeSessions.length,
      stalled: stalled.length,
    };
  }

  private buildHealthSection(
    sessions: Array<{
      id: string;
      status: string;
      currentStage: string | null;
      updatedAt: Date;
      stalledAt: Date | null;
      stageData: unknown;
      macroTask: { title: string; project: { name: string } | null } | null;
    }>,
    stalled: Array<{ id: string }>,
  ): string {
    const stalledIds = new Set(stalled.map((s) => s.id));
    const lines = sessions.map((s) => {
      const pauseReason = (s.stageData as any)?.pauseReason;
      const flag = stalledIds.has(s.id)
        ? s.status === 'paused'
          ? ` | ⏸ PAUSED${pauseReason ? `: ${pauseReason}` : ''}`
          : ' | ⚠ STALLED'
        : '';
      // Deixou de ser "last update Xmin ago": `updatedAt` mede a última escrita
      // na linha, não a última atividade do agente, e o rótulo antigo fazia o
      // Master raciocinar sobre o número errado. Para a travada, o dado com
      // significado é quando o watchdog a marcou.
      const clock = s.stalledAt
        ? `stalled since ${s.stalledAt.toISOString()} (${Math.round((Date.now() - s.stalledAt.getTime()) / 60_000)}min ago)`
        : `row touched ${Math.round((Date.now() - s.updatedAt.getTime()) / 60_000)}min ago`;
      return `- ${s.id} | ${s.macroTask?.project?.name || '?'} / ${s.macroTask?.title || '?'} | status=${s.status} stage=${s.currentStage || '-'} | ${clock}${flag}`;
    });
    return `SESSION HEALTH — inspect the sessions below:

${lines.join('\n')}

For EACH session marked PAUSED or STALLED (and any other that looks suspicious):
1. Call get_session_screen with its sessionId to see what the CLI is doing right now.
2. Decide, in this order — unblocking comes BEFORE escalating, and stopping is the last resort:
   - Working normally (long build/tests, streaming output) → leave it alone.
   - PAUSED with nothing left blocking it (the question that paused it is answered, the conflict is gone) → call resume_session with the sessionId.
   - PAUSED and the current stage itself died mid-way → call retry_stage with the sessionId to re-run that stage from the start.
   - STALLED but still running/waiting → resume_session and retry_stage do NOT apply (they would run the same stage twice). Call log with level "warn" describing what it is stuck on, or stop_session if it is really dead.
   - Waiting for input on something only a human can decide → call log with level "warn" describing exactly what it is waiting for.
   - Dead/crashed (shell prompt, error, exited CLI) and not worth retrying → call stop_session, then log what you saw. This throws the work away, so try resume_session/retry_stage first.
3. Finish with ONE log call: level "info", with a short health report (per session: ok | resumed | retried | waiting | stopped).`;
  }

  /**
   * Relatório de status periódico: o Master analisa o orquestrador e posta um
   * resumo no chat do dashboard via reply_chat (mesmo fluxo do chat manual).
   */
  async sendStatusReport(force = false, projectId?: string): Promise<{ sent: boolean }> {
    const runtime = this.runtime(projectId);
    if (!runtime) return { sent: false };
    if (!force && !runtime.schedulingConfig.statusReportEnabled) return { sent: false };
    if (!(await this.masterRuntime.isRunning(runtime.projectId))) return { sent: false };

    const runId = randomUUID();
    await this.redis
      .getClient()
      .set(MASTER_CHAT_RUN_KEY, runId, 'EX', 3600)
      .catch(() => undefined);
    // Relatório não tem mensagem de usuário que defina a conversa: cai na
    // conversa ativa (ou na mais recente do projeto), nunca solto sem conversa.
    await this.ensureActiveChatSession(runtime.projectId);

    const stats = await this.collectStats(runtime.projectId);
    this.publishActivity({
      runId,
      projectId: runtime.projectId,
      kind: 'chat',
      phase: 'start',
      ts: new Date().toISOString(),
      promptPreview: 'Scheduled status report',
    });

    await this.masterRuntime.sendPrompt(
      runtime.projectId,
      `[ORCHESTRATOR STATUS REPORT] Report requested by the orchestrator (not a user message). ${this.buildStatusReportPrompt(stats)}`,
    );

    await this.prisma.logEntry.create({
      data: {
        projectId: runtime.projectId,
        level: 'info',
        message: 'Master Agent scheduled status report requested',
        metadata: { runId },
      },
    });

    return { sent: true };
  }

  /**
   * Envia UMA pergunta para o terminal do Master triar (caminho avulso:
   * `POST /triage`). A decisão volta via MCP (answer_question /
   * escalate_question), que publica o evento de fim.
   */
  async promptTriage(questionId: string): Promise<void> {
    const projectId = await this.resolveQuestionProject(questionId);
    if (!projectId) return;
    const block = await this.prepareTriage(questionId);
    if (!block) return;
    await this.masterRuntime.sendPrompt(
      projectId,
      `[ORCHESTRATOR TRIAGE] Triage the question below NOW using the orchestrator MCP tools. Do NOT reply in the terminal.\n\n${block}`,
    );
  }

  /**
   * Projeto da pergunta — é ele que decide QUAL Master tria (MT-20). Antes a
   * triagem ia para o único terminal existente, o que com N Masters mandaria a
   * pergunta para o projeto errado. `null` = projeto sem Master ativo.
   */
  private async resolveQuestionProject(questionId: string): Promise<string | null> {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { session: { select: { macroTask: { select: { projectId: true } } } } },
    });
    const projectId = question?.session?.macroTask?.projectId;
    return projectId && this.runtimes.has(projectId) ? projectId : null;
  }

  /**
   * Aplica as regras de triagem a UMA pergunta e devolve o bloco de prompt
   * correspondente — ou `null` quando não há nada a pedir ao Master (pergunta
   * já resolvida, ainda dentro do `repromptAfterMs`, ou escalada direto ao
   * humano aqui mesmo). Compartilhado pelo tick e pelo caminho avulso.
   */
  private async prepareTriage(questionId: string): Promise<string | null> {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        session: { include: { macroTask: { include: { project: true } } } },
      },
    });
    if (!question || question.status !== 'pending') return null;

    // O rate-limit de reprompt é do Master DO PROJETO da pergunta: sem Master
    // ativo lá não há a quem pedir a triagem.
    const runtime = this.runtimes.get(question.session?.macroTask?.projectId ?? '');
    if (!runtime) return null;

    const lastPrompt = runtime.promptedAt.get(questionId);
    if (lastPrompt && Date.now() - lastPrompt < runtime.schedulingConfig.repromptAfterMs) {
      return null;
    }

    const meta = (question.metadata as any) || {};
    const kind = meta.kind;
    const isMergeConflict = kind === 'merge-conflict';

    // MT-27: merge-conflict deixou de ser hard-escalate — o Master tenta uma
    // vez antes. `masterMergeAttempt` marca essa tentativa: na passada
    // seguinte, com a pergunta ainda pendente, a regra volta a ser escalar.
    // `approval` e high-priority genérico continuam indo direto ao humano.
    if (isMergeConflict && !meta.masterMergeAttempt) {
      await this.prisma.question.update({
        where: { id: questionId },
        data: { metadata: { ...meta, masterMergeAttempt: new Date().toISOString() } },
      });
      runtime.promptedAt.set(questionId, Date.now());
      this.publishTriageStart(runtime.projectId, question);
      return this.buildMergeConflictBlock(question, meta);
    }

    if (question.priority === 'high' || kind === 'approval') {
      if (!runtime.promptedAt.has(questionId)) {
        runtime.promptedAt.set(questionId, Date.now());
        await this.recordDecision(runtime.projectId, questionId, 'escalate', {
          reason: isMergeConflict
            ? 'Master already tried to resolve this merge conflict once — handing it to the human'
            : 'High priority / approval questions always go to the human',
        });
      }
      return null;
    }

    runtime.promptedAt.set(questionId, Date.now());
    this.publishTriageStart(runtime.projectId, question);
    return this.buildTriageBlock(question, meta);
  }

  private publishTriageStart(projectId: string, question: { id: string; question: string }) {
    this.publishActivity({
      runId: `triage:${question.id}`,
      projectId,
      kind: 'triage',
      phase: 'start',
      ts: new Date().toISOString(),
      questionId: question.id,
      promptPreview: question.question.slice(0, 200),
    });
  }

  private buildTriageBlock(question: any, meta: Record<string, any>): string {
    const project = question.session?.macroTask?.project;
    return `A coding agent raised a question.

Question id: ${question.id}
Project: ${project?.name || 'unknown'} — ${project?.description || ''}
Task: ${question.session?.macroTask?.title || 'unknown'}
Question:
"""
${question.question}
"""
${meta.context ? `Extra context: ${meta.context}\n` : ''}${meta.options ? `Suggested options: ${JSON.stringify(meta.options)}\n` : ''}${meta.recommended ? `Option recommended by the asking agent: ${meta.recommended}\n` : ''}
Rules:
- If you can answer confidently (project context, engineering conventions, low-stakes detail): call the MCP tool answer_question with questionId, your answer, and confidence (0.0-1.0). Only answer with confidence >= 0.7.
- Otherwise: call the MCP tool escalate_question with questionId, a one-sentence reason, and (optionally) a suggestedAnswer for the human to review.`;
  }

  /**
   * Bloco dedicado ao conflito de merge: leva os arquivos em conflito e o
   * motivo real da escalada, que já vêm no metadata da pergunta criada pelo
   * `escalateMergeConflict`. É a ÚNICA tentativa automática — dela sai ou uma
   * resolução, ou a escalada humana no tick seguinte.
   */
  private buildMergeConflictBlock(question: any, meta: Record<string, any>): string {
    const project = question.session?.macroTask?.project;
    const conflicts: string[] = Array.isArray(meta.conflicts) ? meta.conflicts : [];
    return `MERGE CONFLICT — the orchestrator paused a session and is giving YOU the first attempt before bothering the human.

Question id: ${question.id}
Project: ${project?.name || 'unknown'}
Task: ${question.session?.macroTask?.title || 'unknown'}
Session: ${question.session?.id || 'unknown'} (paused)
Branch: ${question.session?.branchName || 'unknown'}
Conflicting files: ${conflicts.length > 0 ? conflicts.join(', ') : '(not recorded)'}
Escalation reason: ${meta.reason || 'unknown'}
Details:
"""
${question.question}
"""

Rules:
- Reason "foreign-files" means the conflict touches files this task does not own — that is a scope violation, NOT something to force. Prefer escalate_question here.
- Otherwise: inspect the session with get_session_screen and the repo state with query_db/log as needed. If the resolution is unambiguous (imports, changelog, lockfile, a rebase that only needs re-running), call answer_question with questionId and a precise instruction telling the session HOW to resolve it — the session resumes with your answer.
- If you cannot resolve it with confidence, call escalate_question with a one-sentence reason. This is the ONLY automatic attempt: an unresolved conflict goes to the human on the next tick.`;
  }

  private async recordDecision(
    projectId: string,
    questionId: string,
    action: 'answer' | 'escalate',
    extra: { reason?: string; confidence?: number } = {},
  ) {
    await this.redis.publish(CHANNELS.MASTER_DECISION, { questionId, action, ...extra });
    await this.prisma.logEntry.create({
      data: {
        projectId,
        level: 'info',
        message:
          action === 'answer'
            ? `Master Agent auto-answered question ${questionId.slice(0, 8)}`
            : `Master Agent escalated question ${questionId.slice(0, 8)} to human${extra.reason ? `: ${extra.reason}` : ''}`,
        metadata: { questionId, action, ...extra },
      },
    });
  }

  // --------------------------------------------------- chat sessions (P3.2)

  /**
   * Abre uma conversa nova com o Master.
   *
   * Só devolve um id — **nada é persistido aqui**. A conversa passa a existir
   * quando a primeira `ChatMessage` com esse `chatSessionId` é gravada (o
   * agrupamento é derivado das mensagens, não há tabela de conversa). Enquanto
   * isso a UI mostra a conversa como um rascunho local ("New conversation").
   *
   * CA4: este caminho **não toca `master-runtime.service.ts`** — nenhum pane
   * tmux ou processo novo é criado. Continua havendo um único terminal do
   * Master por projeto, independente de quantas conversas existirem.
   */
  createChatSession(): { chatSessionId: string } {
    return { chatSessionId: randomUUID() };
  }

  /**
   * Lista as conversas do chat do Master de um projeto, derivadas das próprias
   * mensagens (`groupBy` por `chatSessionId`), mais recente primeiro.
   *
   * As mensagens pré-migração foram agrupadas no backfill em uma conversa
   * sintética por projeto, então aparecem aqui como a conversa mais antiga
   * (CA3) — não existe caso especial de `chatSessionId` nulo.
   */
  async listChatSessions(projectId?: string): Promise<ChatSessionSummary[]> {
    const groups = await this.prisma.chatMessage.groupBy({
      by: ['chatSessionId'],
      where: {
        chatSessionId: { not: null },
        ...(projectId ? { projectId } : {}),
      },
      _count: { _all: true },
      _min: { timestamp: true },
      _max: { timestamp: true },
    });

    const ids = groups
      .map((g) => g.chatSessionId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) return [];

    // Título = primeira mensagem do usuário da conversa. UMA query para TODAS
    // as conversas (nada de N+1): varre em ordem cronológica e fica com a
    // primeira ocorrência de cada chatSessionId.
    const userMessages = await this.prisma.chatMessage.findMany({
      where: { chatSessionId: { in: ids }, role: 'user' },
      orderBy: { timestamp: 'asc' },
      select: { chatSessionId: true, content: true },
    });
    const firstUserContent = new Map<string, string>();
    for (const msg of userMessages) {
      if (!msg.chatSessionId || firstUserContent.has(msg.chatSessionId)) continue;
      firstUserContent.set(msg.chatSessionId, msg.content);
    }

    return groups
      .filter((g): g is typeof g & { chatSessionId: string } => !!g.chatSessionId)
      .map((g) => ({
        chatSessionId: g.chatSessionId,
        title: this.buildChatSessionTitle(firstUserContent.get(g.chatSessionId)),
        messageCount: g._count._all,
        createdAt: g._min.timestamp?.toISOString() ?? null,
        lastMessageAt: g._max.timestamp?.toISOString() ?? null,
      }))
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  }

  private buildChatSessionTitle(firstUserContent?: string): string {
    const raw = (firstUserContent ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return CHAT_SESSION_FALLBACK_TITLE;
    if (raw.length <= CHAT_SESSION_TITLE_MAX) return raw;
    return `${raw.slice(0, CHAT_SESSION_TITLE_MAX - 1).trimEnd()}…`;
  }

  /**
   * Marca no Redis qual conversa está "ativa" para o próximo `reply_chat`.
   * Falha de Redis não pode derrubar o chat — no pior caso a resposta do agente
   * é gravada sem conversa.
   */
  private async setActiveChatSession(chatSessionId: string): Promise<void> {
    await this.redis
      .getClient()
      .set(MASTER_CHAT_SESSION_KEY, chatSessionId, 'EX', MASTER_CHAT_SESSION_TTL_SECONDS)
      .catch((error) =>
        this.logger.warn(`Failed to persist active chat session: ${error.message}`),
      );
  }

  /**
   * Conversa em que uma resposta NÃO pedida pelo usuário (status report
   * agendado) deve cair: a que já está ativa, senão a mais recente do projeto,
   * senão uma nova. Evita que o relatório vire uma mensagem órfã, sem conversa.
   */
  private async ensureActiveChatSession(projectId: string | null): Promise<string> {
    try {
      const active = await this.redis.getClient().get(MASTER_CHAT_SESSION_KEY);
      if (active) {
        await this.setActiveChatSession(active); // renova o TTL
        return active;
      }
    } catch (error) {
      this.logger.warn(`Failed to read active chat session: ${error.message}`);
    }

    const latest = await this.prisma.chatMessage.findFirst({
      where: { chatSessionId: { not: null }, ...(projectId ? { projectId } : {}) },
      orderBy: { timestamp: 'desc' },
      select: { chatSessionId: true },
    });
    const chatSessionId = latest?.chatSessionId ?? randomUUID();
    await this.setActiveChatSession(chatSessionId);
    return chatSessionId;
  }

  // ------------------------------------------------------------ chat

  /**
   * Chat do usuário com o Master: o prompt entra no terminal interativo e a
   * resposta volta pela MCP tool reply_chat (assíncrono — a UI recebe via
   * SSE master:activity kind=chat phase=end e recarrega as mensagens).
   *
   * `chatSessionId` é **só agrupamento de mensagens** (P3.2): o prompt continua
   * indo para o mesmo e único pane tmux do Master do projeto. Sem ele, uma
   * conversa nova é aberta — assim nenhuma mensagem fica sem conversa.
   */
  async chat(
    message: string,
    chatSessionId?: string,
    projectId?: string,
  ): Promise<{ queued: boolean; response?: string; chatSessionId: string }> {
    const conversationId = chatSessionId?.trim() || randomUUID();
    // Com vários Masters ativos, uma mensagem sem `projectId` não tem destino
    // óbvio — `resolveProjectId` só decide sozinho quando há um único ativo.
    const target = this.resolveProjectId(projectId);
    const runtime = target ? this.runtimes.get(target) : null;

    await this.prisma.chatMessage.create({
      data: {
        role: 'user',
        content: message,
        projectId: target,
        chatSessionId: conversationId,
      },
    });
    // O reply_chat lê essa chave para responder na conversa certa.
    await this.setActiveChatSession(conversationId);

    // Master ativo com terminal morto (tmux caiu sozinho): `ensureTerminal`
    // resobe e devolve false, então esta mensagem explica o que aconteceu em vez
    // de mandar "ative o Master" para quem já o tem ativo — e o reenvio logo
    // depois cai no terminal novo.
    if (!runtime || !(await this.ensureTerminal(runtime.projectId, 'chat'))) {
      const response = runtime
        ? 'The Master Agent terminal had died (the tmux session was gone) and was just restarted — its previous conversation context was lost. Send the message again in a few seconds.'
        : 'The Master Agent terminal is not running. Activate the Master Agent to chat — the conversation happens inside its interactive CLI session.';
      await this.prisma.chatMessage.create({
        data: {
          role: 'agent',
          content: response,
          projectId: target,
          chatSessionId: conversationId,
        },
      });
      return { queued: false, response, chatSessionId: conversationId };
    }

    const runId = randomUUID();
    await this.redis
      .getClient()
      .set(MASTER_CHAT_RUN_KEY, runId, 'EX', 3600)
      .catch(() => undefined);

    this.publishActivity({
      runId,
      projectId: runtime.projectId,
      kind: 'chat',
      phase: 'start',
      ts: new Date().toISOString(),
      promptPreview: message.slice(0, 200),
    });

    const stats = await this.collectStats(runtime.projectId);
    await this.masterRuntime.sendPrompt(
      runtime.projectId,
      `[ORCHESTRATOR CHAT] The user sent a message from the dashboard chat. Reply by calling the MCP tool reply_chat with your answer (plain text, concise and practical). Do NOT just answer in the terminal — the user only sees what you send via reply_chat.

You are the Master Agent of this orchestrator. You have FULL access to it — to inspect or CHANGE anything, use ONLY its MCP tools (never your own local todo/task tools):
- get_status, list_macro_tasks, list_pipelines, list_agents, list_sessions
- create_macro_task / update_macro_task / delete_macro_task (REAL macro tasks on the /macro-tasks page)
- start_macro_task (launches a coding session: worktree + CLI in tmux + pipeline stages)
- resume_session (unblocks a PAUSED session) / retry_stage (re-runs the current stage) / stop_session (last resort — throws the work away)
- create_pipeline / update_pipeline / delete_pipeline, create_agent / update_agent / delete_agent
- query_db (read-only SQL over the whole orchestrator database)
- list_pending_questions, get_question, answer_question, escalate_question
- reindex_context (queue a qmd embed so semantic search stays trustworthy — call it BEFORE opening a parallel wave and AFTER its last session ends; it never runs while a session is active, so it is safe to call any time)
- schedule_loop / cancel_scheduled_loop (send instructions back to your OWN terminal later — use for anything recurring or "in N minutes"; write it self-contained, you will get it with no chat context)

Live orchestrator status: ${JSON.stringify(stats)}

User message:
"""
${message}
"""`,
    );

    return { queued: true, chatSessionId: conversationId };
  }

  /** Retrato do projeto do Master — não do orquestrador todo (MT-20). */
  private async collectStats(projectId: string) {
    const sessionScope = { macroTask: { projectId } };
    const [activeSessions, pendingQuestions, tasks] = await Promise.all([
      this.prisma.session.count({
        where: { status: { in: ['running', 'waiting'] }, ...sessionScope },
      }),
      this.prisma.question.count({ where: { status: 'pending', session: sessionScope } }),
      this.prisma.macroTask.count({ where: { projectId } }),
    ]);
    return { activeSessions, pendingQuestions, macroTasks: tasks };
  }
}
