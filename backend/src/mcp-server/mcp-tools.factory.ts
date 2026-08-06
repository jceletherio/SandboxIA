import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpServerService, MAX_AWAIT_ANSWER_SECONDS } from './mcp-server.service';
import { MasterState } from '../redis/keys';
import { QmdEmbedService } from '../context/qmd-embed.service';

/**
 * Monta um McpServer (SDK oficial) com as tools do orquestrador bindadas a
 * uma sessão já autenticada (Bearer mcpToken → sessionId).
 */
@Injectable()
export class McpToolsFactory {
  constructor(
    private readonly tools: McpServerService,
    private readonly qmdEmbed: QmdEmbedService,
  ) {}

  create(sessionId: string): McpServer {
    const server = new McpServer({
      name: 'orchestrator',
      version: '1.0.0',
    });

    const text = (data: unknown) => ({
      content: [
        {
          type: 'text' as const,
          text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        },
      ],
    });

    server.registerTool(
      'get_task',
      {
        description:
          'Get the full context of your current task: macro task, current stage, previous artifacts and answered questions.',
        inputSchema: {},
      },
      async () => text(await this.tools.getTask(sessionId)),
    );

    server.registerTool(
      'report_progress',
      {
        description: 'Report progress on the current stage.',
        inputSchema: {
          summary: z.string().describe('Short summary of current progress'),
          percent: z.number().min(0).max(100).optional(),
        },
      },
      async ({ summary, percent }) =>
        text(await this.tools.reportProgress(sessionId, { summary, percent })),
    );

    server.registerTool(
      'submit_question',
      {
        description:
          'Submit a question to the orchestrator when you need a decision or missing information. Returns a questionId — poll it with await_answer (bounded timeout, see its description) or check get_task, which also surfaces answered questions.',
        inputSchema: {
          question: z.string(),
          priority: z.enum(['low', 'normal', 'high']).optional(),
          options: z.array(z.string()).optional().describe('Suggested answer options'),
          recommended: z
            .string()
            .optional()
            .describe('The option you recommend (must be one of options)'),
          context: z.string().optional().describe('Context that helps answering'),
        },
      },
      async ({ question, priority, options, recommended, context }) => {
        const created = await this.tools.submitQuestion(sessionId, question, priority || 'normal', {
          options,
          recommended,
          context,
        });
        return text({ questionId: created.id, status: created.status });
      },
    );

    server.registerTool(
      'await_answer',
      {
        description:
          `Wait (bounded, up to ${MAX_AWAIT_ANSWER_SECONDS}s even if you ask for more — the MCP transport can silently drop longer calls) for a question to be answered. Returns the answer, or {timeout:true} if it was not answered yet. On {timeout:true} — or if this call itself errors out at the transport level — call get_task first: the question may already be answered there. Only call await_answer again if it truly is not.`,
        inputSchema: {
          questionId: z.string(),
          timeoutSeconds: z.number().min(5).max(MAX_AWAIT_ANSWER_SECONDS).optional(),
        },
      },
      async ({ questionId, timeoutSeconds }) =>
        text(await this.tools.awaitAnswer(sessionId, questionId, timeoutSeconds ?? 600)),
    );

    server.registerTool(
      'save_artifact',
      {
        description:
          'Persist a stage output (spec, task breakdown, review notes, test report...) in the orchestrator.',
        inputSchema: {
          // 'task-report': report de fim de macro task (contratos §6), lido pela
          // MT-7 para gerar o backlog. Sem ele no enum o report é inescrevível.
          type: z.enum(['spec', 'tasks', 'review', 'test-report', 'task-report', 'code', 'other']),
          path: z.string().describe('Logical path/name of the artifact'),
          content: z.string(),
        },
      },
      async ({ type, path, content }) => {
        const artifact = await this.tools.saveArtifact(sessionId, type, path, content);
        return text({ artifactId: artifact.id });
      },
    );

    server.registerTool(
      'complete_stage',
      {
        description:
          'Signal that the current pipeline stage is fully done. REQUIRED to advance the pipeline. Pass the exact stage name you were asked to execute.',
        inputSchema: {
          stage: z.string(),
          summary: z.string().describe('Short summary of what was accomplished'),
        },
      },
      async ({ stage, summary }) => text(await this.tools.completeStage(sessionId, stage, summary)),
    );

    server.registerTool(
      'get_context',
      {
        description: 'Get project context/documentation. Optionally pass a search query.',
        inputSchema: {
          query: z.string().optional(),
        },
      },
      async ({ query }) => text(await this.tools.getContext(sessionId, query)),
    );

    server.registerTool(
      'log',
      {
        description: 'Send a log message to the orchestrator.',
        inputSchema: {
          level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
          message: z.string(),
        },
      },
      async ({ level, message }) => {
        await this.tools.log(sessionId, level || 'info', message);
        return text({ ok: true });
      },
    );

    server.registerTool(
      'request_approval',
      {
        description:
          'Request explicit human approval for a sensitive action (e.g. destructive change, large refactor). Returns a questionId — poll it with await_answer (bounded timeout) or get_task until approved/rejected.',
        inputSchema: {
          summary: z.string(),
          diff: z.string().optional(),
        },
      },
      async ({ summary, diff }) => {
        const question = await this.tools.requestApproval(sessionId, summary, diff);
        return text({ questionId: question.id });
      },
    );

    server.registerTool(
      'reply_chat',
      {
        description:
          'Send your reply to the user in this session chat on the dashboard. REQUIRED whenever the orchestrator forwards a [SESSION CHAT] message — the user only sees what you send here, never what you type in the terminal.',
        inputSchema: { message: z.string() },
      },
      async ({ message }) => text(await this.tools.sessionReplyChat(sessionId, message)),
    );

    return server;
  }

  /**
   * Servidor MCP do MASTER AGENT (terminal interativo persistente): tools para
   * triar perguntas e responder o chat do dashboard. É por aqui que o Master
   * devolve resultados estruturados — nunca por stdout.
   */
  createMaster(state: MasterState): McpServer {
    const server = new McpServer({
      name: 'orchestrator-master',
      version: '1.0.0',
    });

    const text = (data: unknown) => ({
      content: [
        {
          type: 'text' as const,
          text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        },
      ],
    });

    server.registerTool(
      'get_status',
      {
        description:
          'Live orchestrator status: project, active sessions (each with real runtime telemetry: hasPty, tmuxAlive, lastOutputAt — tmuxAlive=false or a stale lastOutputAt means the session is actually stuck) and pending questions.',
        inputSchema: {},
      },
      async () => text(await this.tools.masterStatus(state)),
    );

    server.registerTool(
      'list_pending_questions',
      {
        description: 'List pending questions from coding agents waiting for triage.',
        inputSchema: {},
      },
      async () => text(await this.tools.masterListPendingQuestions(state)),
    );

    server.registerTool(
      'get_question',
      {
        description:
          'Get the full context of one question by id, including live runtime telemetry of its session when it is active.',
        inputSchema: { questionId: z.string() },
      },
      async ({ questionId }) => text(await this.tools.masterGetQuestion(questionId)),
    );

    server.registerTool(
      'answer_question',
      {
        description:
          'Answer a pending question on behalf of the human. Only use when confident (confidence >= 0.7). High-priority questions are rejected UNLESS you pass humanDirective with the human\'s explicit instruction telling you to resolve it (e.g. from the dashboard chat). Questions of kind approval/merge-conflict ALWAYS require the human — escalate those, humanDirective does not unlock them.',
        inputSchema: {
          questionId: z.string(),
          answer: z.string(),
          confidence: z.number().min(0).max(1).describe('Your confidence in this answer (0.0-1.0)'),
          humanDirective: z
            .string()
            .optional()
            .describe(
              "Verbatim text of the human's EXPLICIT instruction delegating this decision to you. Required to answer high-priority questions; recorded in the audit trail. Never fabricate it.",
            ),
        },
      },
      async ({ questionId, answer, confidence, humanDirective }) =>
        text(
          await this.tools.masterAnswerQuestion(state, questionId, answer, confidence, humanDirective),
        ),
    );

    server.registerTool(
      'dismiss_question',
      {
        description:
          'Dismiss a PENDING question that became obsolete (duplicate, already resolved elsewhere, session moved on) without a human answer. Marks it status "dismissed" with an audit trail and notifies the waiting session with "DISMISSED: <reason>". Use answer_question/escalate_question for questions that still need a real decision.',
        inputSchema: {
          questionId: z.string(),
          reason: z.string().describe('One sentence: why this question is obsolete'),
        },
      },
      async ({ questionId, reason }) =>
        text(await this.tools.masterDismissQuestion(state, questionId, reason)),
    );

    server.registerTool(
      'escalate_question',
      {
        description:
          'Escalate a question to the human inbox. Optionally include a suggestedAnswer the human can accept with one click.',
        inputSchema: {
          questionId: z.string(),
          reason: z.string().describe('One sentence: why a human should decide'),
          suggestedAnswer: z.string().optional(),
          confidence: z.number().min(0).max(1).optional(),
        },
      },
      async ({ questionId, reason, suggestedAnswer, confidence }) =>
        text(
          await this.tools.masterEscalateQuestion(
            state,
            questionId,
            reason,
            suggestedAnswer,
            confidence,
          ),
        ),
    );

    server.registerTool(
      'reply_chat',
      {
        description:
          'Send your reply to the user in the dashboard chat. REQUIRED whenever the orchestrator forwards a chat message — the user only sees what you send here.',
        inputSchema: { message: z.string() },
      },
      async ({ message }) => text(await this.tools.masterReplyChat(state, message)),
    );

    server.registerTool(
      'list_macro_tasks',
      {
        description:
          "List the project's macro tasks in the ORCHESTRATOR (the /macro-tasks page), with status and live sessions.",
        inputSchema: {},
      },
      async () => text(await this.tools.masterListMacroTasks(state)),
    );

    server.registerTool(
      'create_macro_task',
      {
        description:
          'Create a REAL macro task in the orchestrator (shows up on the /macro-tasks page). This is the ONLY way to create macro tasks — never use your own todo/task tools for this.',
        inputSchema: {
          title: z.string(),
          description: z.string().optional(),
          pipeline: z
            .string()
            .optional()
            .describe('Pipeline name or id (defaults to the first active pipeline)'),
          priority: z.number().int().optional(),
        },
      },
      async (input) => text(await this.tools.masterCreateMacroTask(state, input)),
    );

    // Camada mais forte da precedência de config (contratos §3): vence os
    // defaults do projeto, do pipeline e os campos do stage.
    const runtimeLayerSchema = {
      model: z.string().optional().describe('Model name — must be enabled in llm_models'),
      cliProfile: z.string().optional().describe('CLI profile name or id — call list_cli_profiles'),
      subagents: z
        .array(z.string())
        .optional()
        .describe('Subagent names the stage prompt should offer — call list_cli_capabilities'),
      skills: z
        .array(z.string())
        .optional()
        .describe('Skill names the stage prompt should tell the agent to load'),
      // Declarado aqui (e não via `permissionModeSchema`, definido mais abaixo
      // neste mesmo escopo) porque este bloco roda antes daquela const.
      permissionMode: z
        .string()
        .optional()
        .describe('CLI permission mode rendered into the profile args: "acceptEdits", "bypassPermissions", "plan"…'),
    };

    server.registerTool(
      'start_macro_task',
      {
        description:
          'Launch a coding session for a macro task: creates a git worktree, starts the agent CLI in tmux and runs the pipeline stages. Questions the session raises come back to you for triage. Optional "runtime" customises THIS session: model/CLI profile/skills/subagents for the whole session and, in "stages", per stage name (call list_pipelines for the stage names and what they already define). Invalid values are rejected up front — nothing is started.',
        inputSchema: {
          macroTaskId: z.string(),
          agent: z.string().optional().describe('Agent name or id (defaults to the first agent with a CLI profile)'),
          runtime: z
            .object({
              ...runtimeLayerSchema,
              stages: z
                .record(z.string(), z.object(runtimeLayerSchema))
                .optional()
                .describe('Per-stage overrides, keyed by the EXACT stage name of the pipeline'),
            })
            .optional(),
        },
      },
      async ({ macroTaskId, agent, runtime }) =>
        text(await this.tools.masterStartMacroTask(state, macroTaskId, agent, runtime)),
    );

    server.registerTool(
      'update_macro_task',
      {
        description:
          'Update a macro task in the orchestrator: title, description, status, priority or pipeline. Status must be one of backlog|pending|planned|running|review|done|failed|cancelled — anything else is rejected instead of silently stored (a status outside the list makes the task invisible in the UI). "in_progress" and "completed" are still accepted as aliases for "running" and "done".',
        inputSchema: {
          macroTaskId: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
          status: z.string().optional(),
          priority: z.number().int().optional(),
          pipeline: z.string().optional().describe('New pipeline name or id'),
        },
      },
      async (input) => text(await this.tools.masterUpdateMacroTask(state, input)),
    );

    server.registerTool(
      'delete_macro_task',
      {
        description:
          "Archive a macro task (soft-delete: sets status to 'cancelled', never removes the row) and its FINISHED sessions. Fails if the task has a live session — call stop_session first.",
        inputSchema: { macroTaskId: z.string() },
      },
      async ({ macroTaskId }) => text(await this.tools.masterDeleteMacroTask(state, macroTaskId)),
    );

    server.registerTool(
      'stop_session',
      {
        description:
          "Stop (abort) a live coding session: kills its tmux/CLI and marks it 'stopped' — NOT 'completed', so aborted work is distinguishable from finished work. The worktree is kept.",
        inputSchema: { sessionId: z.string() },
      },
      async ({ sessionId }) => text(await this.tools.masterStopSession(state, sessionId)),
    );

    server.registerTool(
      'resume_session',
      {
        description:
          'Resume a PAUSED session (e.g. paused by a merge conflict or by a question that is now answered): re-attaches to the live tmux and re-runs the current stage. Only works on status=paused — on a running/waiting session it would execute the same stage twice. Try this BEFORE stop_session: stopping throws the work away, resuming does not.',
        inputSchema: { sessionId: z.string() },
      },
      async ({ sessionId }) => text(await this.tools.masterResumeSession(state, sessionId)),
    );

    server.registerTool(
      'retry_stage',
      {
        description:
          'Re-run the CURRENT stage of a failed or paused session from the start. Use when the stage itself died (crashed CLI, stage error) and resume_session is not enough.',
        inputSchema: { sessionId: z.string() },
      },
      async ({ sessionId }) => text(await this.tools.masterRetryStage(state, sessionId)),
    );

    const extraMcpServersSchema = z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Extra MCP servers (name -> config object, same shape as mcpServers entries). They are merged into the session\'s rendered mcp-config file, so they work even with --strict-mcp-config.',
      );

    const permissionModeSchema = z
      .string()
      .optional()
      .describe(
        'CLI permission mode rendered into the profile args ({{permissionMode}}): "acceptEdits" (default), "bypassPermissions" (full auto-mode), "plan", etc.',
      );

    const modelSchema = z
      .string()
      .optional()
      .describe('Model name — must be enabled in llm_models. E.g. "opus", "sonnet", "haiku".');

    const cliProfileSchema = z
      .string()
      .optional()
      .describe('CliProfile NAME that boots the CLI (swaps binary/CLI per phase). Call list_cli_profiles.');

    const subagentsSchema = z
      .array(z.string())
      .optional()
      .describe(
        'Subagent names from .claude/agents (no extension) suggested to the agent. Call list_cli_capabilities for the valid names.',
      );

    const skillsSchema = z
      .array(z.string())
      .optional()
      .describe(
        'Skill names from .claude/skills the stage prompt should load. Call list_cli_capabilities for the valid names.',
      );

    const stageSchema = z.object({
      name: z.string(),
      mode: z
        .enum(['interactive', 'oneshot', 'engine'])
        .optional()
        .describe(
          'interactive (default): runs in the visible session CLI. engine: executed by the orchestrator (Merge). oneshot is DEPRECATED and no longer exists in the engine — still accepted for backward compat, but stored/executed as interactive.',
        ),
      timeout: z.number().positive().optional().describe('Timeout in minutes'),
      onQuestion: z.enum(['pause', 'continue']).optional(),
      promptTemplate: z.string().optional(),
      extraMcpServers: extraMcpServersSchema.describe(
        'Extra MCP servers merged into the session mcp-config ONLY for this stage.',
      ),
      permissionMode: permissionModeSchema,
      // MT-18: runtime por estágio (contratos §1). Sem isto o Master não
      // conseguia criar uma pipeline completa por MCP — os campos existiam no
      // contrato e na UI, mas não na borda da tool.
      model: modelSchema,
      cliProfile: cliProfileSchema,
      subagents: subagentsSchema,
      skills: skillsSchema,
    });

    /**
     * Defaults do pipeline (contratos §2). Herdados por todo estágio que não
     * sobrescrever; `subagents`/`skills` são UNIÃO com o estágio, não
     * substituição. Sem `permissionMode` de propósito: ele vive no nível do
     * pipeline e duplicá-lo aqui criaria duas fontes de verdade.
     */
    const pipelineDefaultsSchema = z
      .object({
        model: modelSchema,
        cliProfile: cliProfileSchema,
        subagents: subagentsSchema,
        skills: skillsSchema,
        timeout: z.number().positive().optional().describe('Timeout in minutes'),
      })
      .optional()
      .describe(
        'Runtime defaults inherited by every stage that does not override them (model/cliProfile/subagents/skills/timeout). Precedence: project defaults < pipeline defaults < stage < session override.',
      );

    const kindSchema = z
      .enum(['fixed', 'custom'])
      .optional()
      .describe(
        '"fixed" = reusable general catalogue (shown in the fixed section of /pipelines); "custom" = flow specific to this project. Default when omitted on create: custom.',
      );

    const categorySchema = z
      .string()
      .optional()
      .describe('Filter label on the /pipelines page, e.g. "sdd-complexo", "sdd-simples", "fix-rapido".');

    const tagsSchema = z.array(z.string()).optional().describe('Free-form filter tags on the /pipelines page.');

    /**
     * Backward compat na borda: a tool ainda ACEITA mode "oneshot" (prompts e
     * pipelines antigos do Master), mas o engine só conhece interactive|engine.
     * Rebaixa aqui para o pipeline já nascer com o modo real, sem quebrar quem
     * envia o valor legado.
     */
    const normalizeStageModes = <T extends { mode?: 'interactive' | 'oneshot' | 'engine' }>(
      stages: T[],
    ): Array<Omit<T, 'mode'> & { mode?: 'interactive' | 'engine' }> =>
      stages.map((stage) => ({
        ...stage,
        mode: stage.mode === 'oneshot' ? ('interactive' as const) : stage.mode,
      }));

    const permissionsSchema = z
      .array(z.string())
      .optional()
      .describe(
        'Claude Code permission rules (e.g. "mcp__figma__*", "Bash(npm test:*)") seeded as the allowlist (permissions.allow) in the worktree\'s .claude/settings.local.json, avoiding approval prompts in headless runs.',
      );

    server.registerTool(
      'create_pipeline',
      {
        description:
          'Create a REAL pipeline in the orchestrator (shows up on the /pipelines page). Stages run in order; use mode "engine" with name "Merge" for the merge stage. Optional: permissions (allowlist written to the worktree settings.local.json) and extraMcpServers (merged into the session mcp-config file — works even with --strict-mcp-config), at pipeline level and/or per stage; catalogue metadata (kind/category/tags) and runtime defaults + per-stage model/cliProfile/subagents/skills. Everything you pass here loads back in the /pipelines editor.',
        inputSchema: {
          name: z.string(),
          description: z.string().optional(),
          stages: z.array(stageSchema).min(1),
          activate: z.boolean().optional().describe('Default true'),
          permissions: permissionsSchema,
          extraMcpServers: extraMcpServersSchema.describe(
            'Extra MCP servers merged into the session mcp-config for ALL stages.',
          ),
          permissionMode: permissionModeSchema,
          kind: kindSchema,
          category: categorySchema,
          tags: tagsSchema,
          defaults: pipelineDefaultsSchema,
        },
      },
      async (input) =>
        text(
          await this.tools.masterCreatePipeline(state, {
            ...input,
            stages: normalizeStageModes(input.stages),
          }),
        ),
    );

    server.registerTool(
      'update_pipeline',
      {
        description:
          'Update a pipeline: name, description, isActive, the full stages list, permissions (worktree allowlist), extraMcpServers (merged into the session mcp-config), catalogue metadata (kind/category/tags) and/or runtime defaults. Fields not passed are preserved — including the ones this tool did not use to accept.',
        inputSchema: {
          pipelineId: z.string().describe('Pipeline id or name'),
          name: z.string().optional(),
          description: z.string().optional(),
          isActive: z.boolean().optional(),
          stages: z
            .array(stageSchema)
            .min(1)
            .optional()
            .describe(
              'Replaces ALL stages — a stage omitted here is deleted, and so is any per-stage field you do not repeat (permissionMode, extraMcpServers, model, subagents…). Read list_pipelines first and send the full stage back.',
            ),
          permissions: permissionsSchema.describe('Replaces the pipeline permissions allowlist'),
          extraMcpServers: extraMcpServersSchema.describe(
            'Replaces the pipeline-level extra MCP servers (merged into the session mcp-config for all stages).',
          ),
          permissionMode: permissionModeSchema.describe('Replaces the pipeline permissionMode'),
          kind: kindSchema.describe('Replaces the pipeline kind (fixed|custom)'),
          category: categorySchema.describe('Replaces the pipeline category'),
          tags: tagsSchema.describe('Replaces ALL tags'),
          defaults: pipelineDefaultsSchema.describe(
            'Replaces the WHOLE defaults block — a field you omit is dropped, not merged.',
          ),
        },
      },
      async (input) =>
        text(
          await this.tools.masterUpdatePipeline(state, {
            ...input,
            stages: input.stages ? normalizeStageModes(input.stages) : undefined,
          }),
        ),
    );

    server.registerTool(
      'delete_pipeline',
      {
        description: 'Delete a pipeline. Fails if any macro task still uses it.',
        inputSchema: { pipeline: z.string().describe('Pipeline id or name') },
      },
      async ({ pipeline }) => text(await this.tools.masterDeletePipeline(state, pipeline)),
    );

    server.registerTool(
      'create_agent',
      {
        description:
          'Create an agent (who runs coding sessions) in the project, bound to a CLI profile (defaults to the first one).',
        inputSchema: {
          name: z.string(),
          cliProfile: z.string().optional().describe('CLI profile name or id'),
          model: z.string().optional(),
          type: z.string().optional(),
        },
      },
      async (input) => text(await this.tools.masterCreateAgent(state, input)),
    );

    server.registerTool(
      'update_agent',
      {
        description: 'Update an agent: name, model and/or CLI profile.',
        inputSchema: {
          agentId: z.string().describe('Agent id or name'),
          name: z.string().optional(),
          model: z.string().optional(),
          cliProfile: z.string().optional().describe('CLI profile name or id'),
        },
      },
      async (input) => text(await this.tools.masterUpdateAgent(state, input)),
    );

    server.registerTool(
      'delete_agent',
      {
        description: 'Delete an agent. Fails if it has sessions in history.',
        inputSchema: { agent: z.string().describe('Agent id or name') },
      },
      async ({ agent }) => text(await this.tools.masterDeleteAgent(state, agent)),
    );

    server.registerTool(
      'query_db',
      {
        description:
          "Run a READ-ONLY SQL query (SELECT / WITH) directly on the orchestrator's PostgreSQL database — full inspection access to every table (projects, macro_tasks, sessions, questions, pipelines, agents, sdd_artifacts, log_entries, chat_messages, cli_profiles...). Writes are blocked: use the dedicated tools for mutations.",
        inputSchema: {
          sql: z.string(),
          limit: z.number().int().min(1).max(500).optional().describe('Max rows returned (default 100)'),
        },
      },
      async ({ sql, limit }) => text(await this.tools.masterQueryDb(state, sql, limit)),
    );

    server.registerTool(
      'list_pipelines',
      {
        description: "List the project's pipelines (stage sequences a macro task can run).",
        inputSchema: {},
      },
      async () => text(await this.tools.masterListPipelines(state)),
    );

    server.registerTool(
      'list_cli_capabilities',
      {
        description:
          "List the subagents (.claude/agents) and skills (.claude/skills) that exist in the project repo, with their descriptions. These are the ONLY valid names for start_macro_task runtime.subagents / runtime.skills. Read-only — create and edit them on the /agents page.",
        inputSchema: {},
      },
      async () => text(await this.tools.masterListCliCapabilities(state)),
    );

    server.registerTool(
      'list_agents',
      {
        description: "List the project's agents (who can run coding sessions) and their CLI profiles.",
        inputSchema: {},
      },
      async () => text(await this.tools.masterListAgents(state)),
    );

    server.registerTool(
      'list_sessions',
      {
        description:
          'List recent coding sessions of the project with status, current stage and — for live sessions — real runtime telemetry (hasPty, tmuxAlive, lastOutputAt). Use it to detect sessions that LOOK running but are actually dead/stuck (tmuxAlive=false, stale lastOutputAt).',
        inputSchema: {},
      },
      async () => text(await this.tools.masterListSessions(state)),
    );

    server.registerTool(
      'get_session_screen',
      {
        description:
          "See a session's terminal without Bash: returns the last lines currently on the session tmux screen (lastScreen) plus runtime telemetry. Use it to diagnose stuck sessions, permission prompts or CLI errors.",
        inputSchema: { sessionId: z.string() },
      },
      async ({ sessionId }) => text(await this.tools.masterGetSessionScreen(state, sessionId)),
    );

    server.registerTool(
      'list_cli_profiles',
      {
        description:
          'List the CLI profiles (how each agent CLI is launched: binary, args, MCP config file/template, default model). Agents reference a profile by name/id.',
        inputSchema: {},
      },
      async () => text(await this.tools.masterListCliProfiles(state)),
    );

    server.registerTool(
      'create_cli_profile',
      {
        description:
          'Create a CLI profile (a launchable agent CLI). Placeholders in args/template are rendered per session: {{prompt}}, {{model}}, {{mcpConfigPath}}, {{url}}, {{token}}, {{resumeId}}. mcpConfigTemplate defaults to the orchestrator HTTP MCP server; mcpConfigFile is the path (relative to the worktree) where it is written.',
        inputSchema: {
          name: z.string(),
          binary: z.string().describe('Executable, e.g. "claude" or "opencode"'),
          interactiveArgs: z
            .array(z.string())
            .optional()
            .describe('Args for the persistent interactive session (default [])'),
          mcpConfigFile: z
            .string()
            .optional()
            .describe('Worktree-relative path of the rendered MCP config (default ".orchestrator/mcp.json")'),
          mcpConfigTemplate: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('MCP config template object with {{url}}/{{token}} placeholders'),
          env: z.record(z.string(), z.string()).optional().describe('Extra env vars for the CLI process'),
          defaultModel: z.string().optional(),
        },
      },
      async (input) => text(await this.tools.masterCreateCliProfile(state, input)),
    );

    server.registerTool(
      'update_cli_profile',
      {
        description:
          'Update a CLI profile by id or name. Only the fields you pass change. Careful with builtin profiles — every agent bound to the profile is affected.',
        inputSchema: {
          cliProfile: z.string().describe('CLI profile id or name'),
          name: z.string().optional(),
          binary: z.string().optional(),
          interactiveArgs: z.array(z.string()).optional(),
          mcpConfigFile: z.string().optional(),
          mcpConfigTemplate: z.record(z.string(), z.unknown()).optional(),
          env: z.record(z.string(), z.string()).optional(),
          defaultModel: z.string().optional(),
        },
      },
      async (input) => text(await this.tools.masterUpdateCliProfile(state, input)),
    );

    server.registerTool(
      'log',
      {
        description: 'Log a message in the orchestrator (visible in the Logs page).',
        inputSchema: {
          level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
          message: z.string(),
        },
      },
      async ({ level, message }) => {
        await this.tools.masterLog(state, level || 'info', message);
        return text({ ok: true });
      },
    );

    server.registerTool(
      'schedule_loop',
      {
        description:
          'Schedule instructions to be sent BACK TO YOUR OWN terminal later by the orchestrator (shows up on the /scheduler page). Use it whenever the user asks for something recurring or for later ("check X every hour", "remind me in 30 min", "keep watching the sessions 5 times"). Write `instructions` as a self-contained task for your future self — you will receive it with no conversation context. Without repeatIntervalMinutes it fires ONCE. With repeatIntervalMinutes and no maxRuns it repeats until cancelled. This does NOT run anything now.',
        inputSchema: {
          instructions: z
            .string()
            .describe('Self-contained task to execute on every run (no chat context available)'),
          startInMinutes: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Minutes from now for the FIRST run (default 0 = as soon as possible)'),
          repeatIntervalMinutes: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Minutes between runs. Omit for a one-off schedule'),
          maxRuns: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Stop after this many runs (rate-limit). Omit to repeat until cancelled'),
          notes: z.string().optional().describe('Short human-readable note shown on the /scheduler page'),
        },
      },
      async (input) => text(await this.tools.masterScheduleLoop(state, input)),
    );

    server.registerTool(
      'cancel_scheduled_loop',
      {
        description:
          'Cancel (pause) scheduled loops of this project created with schedule_loop. Pass jobId to cancel one; omit it to cancel every active loop of the project ("stop reminding me").',
        inputSchema: {
          jobId: z.string().optional().describe('Id returned by schedule_loop. Omit to cancel all active loops'),
        },
      },
      async ({ jobId }) => text(await this.tools.masterCancelScheduledLoop(state, jobId)),
    );

    // ---------------------------------------------------------- MT-6: reindex
    // Delega direto ao QmdEmbedService (não passa pelo McpServerService): a tool
    // é só uma casca sobre `requestReindex`, que já é a fonte única da
    // serialização do embed.
    server.registerTool(
      'reindex_context',
      {
        description:
          'Queue a qmd reindex (embed) of the project so semantic search stays trustworthy. Call it BEFORE opening a parallel wave and AFTER the last session of the wave finishes. It NEVER runs while any session is active (running/waiting/initializing) — in that case it is queued and only starts after the last one ends, so the embed never competes with the wave for CPU. One embed per machine, at low priority. Read the returned `reason`: it says whether it was queued, when it will run, or why it was skipped.',
        inputSchema: {
          reason: z
            .enum(['pre-wave', 'post-wave', 'manual'])
            .optional()
            .describe('Why the reindex was asked for (default "manual"). Shows up on the /context page'),
        },
      },
      async ({ reason }) => text(await this.qmdEmbed.requestReindex(state.projectId, reason || 'manual')),
    );

    return server;
  }
}
