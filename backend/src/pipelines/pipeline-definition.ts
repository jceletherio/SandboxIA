/**
 * Definição pura de pipeline (tipos + validação), compartilhada entre o CRUD
 * de pipelines e o pipeline-engine — sem dependências de Nest/Prisma.
 */
export interface PipelineStage {
  name: string;
  /** Rótulo lógico do estágio (legado) — NÃO é o executor. */
  agent?: string;
  timeout?: number; // minutos
  onQuestion?: 'pause' | 'continue';
  /** interactive: prompt na sessão CLI viva; engine: executado pelo orquestrador (ex.: Merge) */
  mode?: 'interactive' | 'engine';
  promptTemplate?: string;
  /** Servidores MCP extras mesclados no mcp-config da sessão apenas para este estágio. */
  extraMcpServers?: Record<string, unknown>;
  /** Sobrescreve o permissionMode do pipeline só neste estágio. */
  permissionMode?: string;

  // --- MT-0: configuração de runtime por estágio (todos opcionais) ---
  /** Modelo do CLI só neste estágio. Ex.: "opus", "sonnet", "haiku". */
  model?: string;
  /** Nome do CliProfile que sobe o CLI neste estágio. Troca de binário/CLI por fase. */
  cliProfile?: string;
  /** Subagentes `.claude/agents/*.md` sugeridos ao agente neste estágio (sem extensão). */
  subagents?: string[];
  /** Skills `.claude/skills/*` que o prompt do estágio deve mandar carregar. */
  skills?: string[];
}

/**
 * Defaults do pipeline aplicados a todos os estágios que não sobrescreverem.
 * Mesmos campos de runtime do estágio, sem `permissionMode` — esse já existe no
 * nível do pipeline (`PipelineDefinition.permissionMode`) desde antes da MT-0 e
 * duplicá-lo aqui criaria duas fontes de verdade na mesma camada.
 */
export interface PipelineDefaults {
  model?: string;
  cliProfile?: string;
  subagents?: string[];
  skills?: string[];
  timeout?: number; // minutos
}

export interface PipelineDefinition {
  name?: string;
  description?: string;
  stages: PipelineStage[];
  /**
   * Regras de permissão do Claude Code (ex.: "mcp__figma__*", "Bash(npm test:*)")
   * semeadas em permissions.allow do .claude/settings.local.json do worktree,
   * evitando travas de aprovação em execução headless.
   */
  permissions?: string[];
  /** Servidores MCP extras mesclados no mcp-config da sessão para todos os estágios. */
  extraMcpServers?: Record<string, unknown>;
  /**
   * Modo de permissão do CLI (placeholder {{permissionMode}} nos args do
   * cli_profile). Ex.: "acceptEdits" (default), "bypassPermissions" (auto-mode
   * total), "plan". Sobrescrevível por estágio.
   */
  permissionMode?: string;

  // --- MT-0: catálogo e defaults (todos opcionais) ---
  /** "fixed" = catálogo geral reusável; "custom" = fluxo específico de um projeto. */
  kind?: PipelineKind;
  /** Rótulo de filtro na /pipelines. Ex.: "sdd-complexo", "sdd-simples", "fix-rapido". */
  category?: string;
  /** Tags livres de filtro. */
  tags?: string[];
  /** Defaults aplicados a todos os estágios que não sobrescreverem. */
  defaults?: PipelineDefaults;
}

export type PipelineKind = 'fixed' | 'custom';

const VALID_MODES = new Set(['interactive', 'engine']);
const VALID_KINDS = new Set<string>(['fixed', 'custom']);
/**
 * Modos deprecados -> modo atual equivalente.
 *
 * "oneshot" rodava um CLI headless em paralelo ao CLI interativo do tmux
 * (invisível, sem TTY para aprovações) e foi removido do engine. Pipelines
 * gravados antes da remoção ainda podem ter `mode: "oneshot"` no Json do banco,
 * e a MCP tool `create_pipeline` ainda aceita o valor por backward compat —
 * então a validação NÃO rejeita o alias e `normalizePipelineDefinition` faz o
 * downgrade silencioso para "interactive" na leitura, que é exatamente como o
 * engine já executava esses estágios. Sem migration destrutiva de dados.
 */
const DEPRECATED_MODE_ALIASES: Record<string, 'interactive' | 'engine'> = {
  oneshot: 'interactive',
};
const VALID_ON_QUESTION = new Set(['pause', 'continue']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Helpers de validação de campo OPCIONAL: `undefined` sempre passa. É o que
 * garante que pipeline gravado antes da MT-0 (sem nenhum campo novo) continue
 * carregando. `null` é rejeitado de propósito — vem de UI/Json mal preenchido e
 * silenciar viraria bug de configuração fantasma mais tarde.
 */
function assertOptionalString(value: unknown, label: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertOptionalStringArray(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
}

function assertOptionalPositiveNumber(value: unknown, label: string): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number of minutes`);
  }
}

/** Valida o bloco de defaults do pipeline (§2 dos contratos). */
function validatePipelineDefaults(defaults: unknown, label: string): void {
  if (defaults === undefined) return;
  if (!isPlainObject(defaults)) {
    throw new Error(`${label} must be a plain object`);
  }
  assertOptionalString(defaults.model, `${label}.model`);
  assertOptionalString(defaults.cliProfile, `${label}.cliProfile`);
  assertOptionalStringArray(defaults.subagents, `${label}.subagents`);
  assertOptionalStringArray(defaults.skills, `${label}.skills`);
  assertOptionalPositiveNumber(defaults.timeout, `${label}.timeout`);
}

export function validatePipelineDefinition(pipeline: PipelineDefinition): void {
  if (!pipeline || !Array.isArray(pipeline.stages) || pipeline.stages.length === 0) {
    throw new Error('Pipeline must have at least one stage');
  }
  if (pipeline.permissions !== undefined) {
    if (
      !Array.isArray(pipeline.permissions) ||
      pipeline.permissions.some((p) => typeof p !== 'string' || !p.trim())
    ) {
      throw new Error('Pipeline "permissions" must be an array of non-empty strings');
    }
  }
  if (pipeline.extraMcpServers !== undefined && !isPlainObject(pipeline.extraMcpServers)) {
    throw new Error('Pipeline "extraMcpServers" must be a plain object (server name -> config)');
  }
  if (
    pipeline.permissionMode !== undefined &&
    (typeof pipeline.permissionMode !== 'string' || !pipeline.permissionMode.trim())
  ) {
    throw new Error('Pipeline "permissionMode" must be a non-empty string');
  }
  if (pipeline.kind !== undefined && !VALID_KINDS.has(pipeline.kind)) {
    throw new Error(`Pipeline "kind" must be one of: fixed|custom (got "${pipeline.kind}")`);
  }
  assertOptionalString(pipeline.category, 'Pipeline "category"');
  assertOptionalStringArray(pipeline.tags, 'Pipeline "tags"');
  validatePipelineDefaults(pipeline.defaults, 'Pipeline "defaults"');
  const names = new Set<string>();
  for (const stage of pipeline.stages) {
    if (!stage || typeof stage.name !== 'string' || !stage.name.trim()) {
      throw new Error('Each stage must have a name');
    }
    if (names.has(stage.name)) throw new Error(`Duplicate stage name: ${stage.name}`);
    names.add(stage.name);
    if (
      stage.mode !== undefined &&
      !VALID_MODES.has(stage.mode) &&
      !(stage.mode in DEPRECATED_MODE_ALIASES)
    ) {
      throw new Error(`Stage "${stage.name}": invalid mode "${stage.mode}" (interactive|engine)`);
    }
    if (stage.onQuestion !== undefined && !VALID_ON_QUESTION.has(stage.onQuestion)) {
      throw new Error(`Stage "${stage.name}": invalid onQuestion "${stage.onQuestion}" (pause|continue)`);
    }
    if (stage.timeout !== undefined && (typeof stage.timeout !== 'number' || stage.timeout <= 0)) {
      throw new Error(`Stage "${stage.name}": timeout must be a positive number of minutes`);
    }
    if (stage.extraMcpServers !== undefined && !isPlainObject(stage.extraMcpServers)) {
      throw new Error(
        `Stage "${stage.name}": "extraMcpServers" must be a plain object (server name -> config)`,
      );
    }
    // MT-0: config de runtime por estágio — opcional, tipada quando presente.
    assertOptionalString(stage.model, `Stage "${stage.name}": "model"`);
    assertOptionalString(stage.cliProfile, `Stage "${stage.name}": "cliProfile"`);
    assertOptionalStringArray(stage.subagents, `Stage "${stage.name}": "subagents"`);
    assertOptionalStringArray(stage.skills, `Stage "${stage.name}": "skills"`);
  }
}

/**
 * Fallback retroativo (não destrutivo): reescreve modos deprecados para o
 * equivalente atual sem tocar no registro do banco. Devolve o mesmo objeto
 * quando não há nada a converter, para não alocar à toa.
 */
function withDeprecatedModeAliases(def: PipelineDefinition): PipelineDefinition {
  if (!def || !Array.isArray(def.stages)) return def;
  let changed = false;
  const stages = def.stages.map((stage) => {
    if (!stage || typeof stage !== 'object') return stage;
    const alias = DEPRECATED_MODE_ALIASES[stage.mode as unknown as string];
    if (!alias) return stage;
    changed = true;
    return { ...stage, mode: alias };
  });
  return changed ? { ...def, stages } : def;
}

/** Campos opcionais da MT-0 que aceitam `null` no Json e são limpos na leitura. */
const NULLABLE_PIPELINE_FIELDS = ['kind', 'category', 'tags', 'defaults'] as const;
const NULLABLE_STAGE_FIELDS = ['model', 'cliProfile', 'subagents', 'skills'] as const;

/**
 * Remove os campos da MT-0 que vierem `null` (ou `undefined` explícito).
 *
 * Por que existe: `normalizePipelineDefinition` também é o caminho de LEITURA do
 * pipeline (engine e session-runtime chamam em toda execução) e ele valida. Um
 * formulário de UI que serializa campo vazio como `null` — comportamento padrão
 * de JSON — gravaria `{"tags": null}` e, com a validação cobrando o tipo, o
 * pipeline viraria IMPOSSÍVEL de carregar: a sessão nem inicia. Perder o
 * pipeline é muito pior que ignorar um campo vazio.
 *
 * Limpar em vez de só tolerar mantém o tipo honesto para quem consome: ninguém
 * recebe `tags: null` tipado como `string[]` e quebra num `.map`. A validação
 * segue estrita — ela simplesmente nunca vê o `null`.
 */
function withoutNullOptionalFields(def: PipelineDefinition): PipelineDefinition {
  if (!isPlainObject(def)) return def;
  let changed = false;
  const out: Record<string, unknown> = { ...def };

  for (const field of NULLABLE_PIPELINE_FIELDS) {
    if (field in out && (out[field] === null || out[field] === undefined)) {
      delete out[field];
      changed = true;
    }
  }

  if (Array.isArray(out.stages)) {
    const stages = (out.stages as unknown[]).map((stage) => {
      if (!isPlainObject(stage)) return stage;
      let stageChanged = false;
      const cleaned: Record<string, unknown> = { ...stage };
      for (const field of NULLABLE_STAGE_FIELDS) {
        if (field in cleaned && (cleaned[field] === null || cleaned[field] === undefined)) {
          delete cleaned[field];
          stageChanged = true;
        }
      }
      if (!stageChanged) return stage;
      changed = true;
      return cleaned;
    });
    if (changed) out.stages = stages;
  }

  return (changed ? (out as unknown as PipelineDefinition) : def);
}

/**
 * Aceita tanto `{ stages: [...] }` quanto `[...]` (formato do Json do banco).
 *
 * É o ponto de entrada de leitura E de validação de escrita. Use SEMPRE esta
 * função em vez de chamar `validatePipelineDefinition` direto: só ela aplica os
 * fallbacks retroativos (modo deprecado, campo novo `null`).
 */
export function normalizePipelineDefinition(stagesJson: unknown): PipelineDefinition {
  const raw: PipelineDefinition = Array.isArray(stagesJson)
    ? { stages: stagesJson as PipelineStage[] }
    : (stagesJson as PipelineDefinition);
  // Pipelines antigos podem trazer mode: "oneshot" — rebaixa para "interactive"
  // ANTES de validar/executar, em vez de quebrar em runtime.
  const def = withoutNullOptionalFields(withDeprecatedModeAliases(raw));
  validatePipelineDefinition(def);
  return def;
}
