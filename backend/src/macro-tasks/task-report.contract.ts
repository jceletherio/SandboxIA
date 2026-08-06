/**
 * Report de fim de macro task (contratos §6) — módulo PURO.
 *
 * O `content` desse artefato é escrito por um LLM, não por código. Então este
 * parser trata "JSON quebrado" como caso NORMAL, não como exceção: ele nunca
 * lança, devolve o que conseguiu aproveitar e lista em `errors` tudo que
 * descartou ou corrigiu. Quem chama decide o que fazer com a sobra — o
 * `BacklogIngestService` transforma `errors` num item de backlog para inspeção
 * humana em vez de perder a informação em silêncio.
 */

export const FINDING_KINDS = ['bug', 'improvement', 'optimization', 'debt', 'docs'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const FINDING_EFFORTS = ['s', 'm', 'l'] as const;
export type FindingEffort = (typeof FINDING_EFFORTS)[number];

/** `kind` fora do enum não é descartado: cai aqui e o desvio vai para `errors`. */
export const DEFAULT_KIND: FindingKind = 'improvement';
/** `effort` ausente/inválido vira o do meio — nem otimista, nem pessimista. */
export const DEFAULT_EFFORT: FindingEffort = 'm';
/** `priority` do finding é clampada aqui; a fórmula de score conta com esse teto. */
export const MAX_FINDING_PRIORITY = 2;

export interface TaskReportFinding {
  kind: FindingKind;
  title: string;
  detail?: string;
  files: string[];
  effort: FindingEffort;
  priority: number;
  /**
   * Como o finding foi comprovado: `arquivo:linha`, comando rodado, saída obtida.
   * OPCIONAL de propósito — report antigo não tem, e cobrar o campo faria o
   * finding ser descartado, que é pior que ingerir sem prova. Ausência é sinal,
   * não erro: `buildDescription` avisa o consumidor de que não há o que reconferir.
   */
  evidence?: string[];
}

export interface TaskReport {
  macroTaskId?: string;
  sessionId?: string;
  summary?: string;
  findings: TaskReportFinding[];
}

/**
 * `findings.length === 0` NÃO é conclusão suficiente: uma sessão que legitimamente
 * não tem nada a reportar chega aqui igual a um report ilegível. Quem decide criar
 * item de dívida olha ISTO, não o tamanho da lista.
 *
 * - `ok` — sobrou pelo menos um finding aproveitável.
 * - `empty` — parseou e o report declara zero findings. **Resultado válido**: fecha
 *   a task em silêncio, sem item de dívida e sem artefato de diagnóstico.
 * - `unparseable` — não sobrou nada legível, ou havia findings declarados e nenhum
 *   sobreviveu à normalização (informação perdida, precisa de olho humano).
 */
export type TaskReportOutcome = 'ok' | 'empty' | 'unparseable';

export interface TaskReportParseResult {
  /** `null` quando não sobrou nem um objeto JSON reconhecível no texto cru. */
  report: TaskReport | null;
  /** Findings aproveitáveis. Pode estar vazio mesmo com `report` preenchido. */
  findings: TaskReportFinding[];
  /** Um item por problema encontrado. Vazio = report perfeito. */
  errors: string[];
  /** Veredito do parser. Use este campo para decidir, nunca `findings.length`. */
  outcome: TaskReportOutcome;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Tira a cerca de markdown que o CLI adiciona por hábito (```json … ```) mesmo
 * quando o prompt pede JSON puro.
 */
function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json|jsonc)?\s*\n([\s\S]*?)\n?\s*```\s*$/i.exec(text);
  return fenced ? fenced[1] : text;
}

/**
 * Última tentativa antes de desistir: recorta do primeiro `{` até o último `}`.
 * Cobre o caso recorrente de o agente escrever uma frase de introdução antes do
 * JSON ("Aqui está o report: {…}"), que é erro de forma, não de conteúdo.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function parseLoose(raw: string): { value: unknown; recovered: boolean } | null {
  try {
    return { value: JSON.parse(raw), recovered: false };
  } catch {
    // segue para o recorte
  }
  const carved = extractJsonObject(raw);
  if (!carved) return null;
  try {
    return { value: JSON.parse(carved), recovered: true };
  } catch {
    return null;
  }
}

/**
 * Aceita lista de strings como array ou como string única (o formato erra nos dois
 * sentidos). Serve `files` e `evidence` — os dois campos de lista do finding.
 */
function normalizeStringList(
  value: unknown,
  errors: string[],
  where: string,
  field: string,
): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  if (!Array.isArray(value)) errors.push(`${where}: "${field}" não é array — tratado como lista de 1.`);
  const out: string[] = [];
  for (const entry of list) {
    const file = cleanString(entry);
    if (file && !out.includes(file)) out.push(file);
  }
  return out;
}

function normalizeFinding(
  raw: unknown,
  index: number,
  errors: string[],
): TaskReportFinding | null {
  const where = `finding[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${where}: não é objeto — descartado.`);
    return null;
  }
  const source = raw as Record<string, unknown>;

  // `title` é o único campo sem default possível: sem ele o item de backlog não
  // tem como ser lido nem deduplicado, então o finding vai fora.
  const title = cleanString(source.title);
  if (!title) {
    errors.push(`${where}: sem "title" — descartado.`);
    return null;
  }

  const rawKind = cleanString(source.kind)?.toLowerCase();
  let kind: FindingKind = DEFAULT_KIND;
  if (rawKind && (FINDING_KINDS as readonly string[]).includes(rawKind)) {
    kind = rawKind as FindingKind;
  } else if (rawKind) {
    errors.push(`${where}: kind "${rawKind}" fora do enum — assumido "${DEFAULT_KIND}".`);
  } else {
    errors.push(`${where}: sem "kind" — assumido "${DEFAULT_KIND}".`);
  }

  const rawEffort = cleanString(source.effort)?.toLowerCase();
  let effort: FindingEffort = DEFAULT_EFFORT;
  if (rawEffort && (FINDING_EFFORTS as readonly string[]).includes(rawEffort)) {
    effort = rawEffort as FindingEffort;
  } else if (rawEffort) {
    errors.push(`${where}: effort "${rawEffort}" inválido — assumido "${DEFAULT_EFFORT}".`);
  }

  // Prioridade vem como número ou como string ("1"); fora disso é 0.
  const rawPriority =
    typeof source.priority === 'number'
      ? source.priority
      : typeof source.priority === 'string'
        ? Number(source.priority)
        : 0;
  const priority = Number.isFinite(rawPriority)
    ? Math.min(Math.max(Math.trunc(rawPriority), 0), MAX_FINDING_PRIORITY)
    : 0;

  // `evidence` não ganha erro quando falta: o consumidor trata ausência de prova
  // como aviso na descrição, não como report torto.
  const evidence = normalizeStringList(source.evidence, errors, where, 'evidence');

  return {
    kind,
    title,
    detail: cleanString(source.detail),
    files: normalizeStringList(source.files, errors, where, 'files'),
    effort,
    priority,
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}

/**
 * Lê o `content` cru do artefato. NUNCA lança — é chamada no caminho de
 * conclusão de sessão, onde uma exceção atrasaria o cleanup e o merge.
 */
export function parseTaskReport(raw: string | null | undefined): TaskReportParseResult {
  const errors: string[] = [];
  const text = cleanString(raw);
  if (!text) {
    // Artefato existe mas está vazio: não é o mesmo que "não tinha nada a
    // reportar" — alguém gravou um report em branco. Vai para inspeção.
    return { report: null, findings: [], errors: ['Report vazio ou ausente.'], outcome: 'unparseable' };
  }

  const parsed = parseLoose(stripCodeFence(text));
  if (!parsed) {
    return { report: null, findings: [], errors: ['JSON não parseável.'], outcome: 'unparseable' };
  }
  if (parsed.recovered) {
    errors.push('JSON recuperado por recorte — havia texto fora do objeto.');
  }

  // O agente às vezes grava só o array de findings, sem o envelope.
  const envelope = Array.isArray(parsed.value)
    ? { findings: parsed.value }
    : (parsed.value as Record<string, unknown>);
  if (!envelope || typeof envelope !== 'object') {
    return {
      report: null,
      findings: [],
      errors: [...errors, 'Conteúdo não é objeto nem array.'],
      outcome: 'unparseable',
    };
  }
  if (Array.isArray(parsed.value)) {
    errors.push('Report veio como array — tratado como lista de findings sem envelope.');
  }

  const rawFindings = (envelope as { findings?: unknown }).findings;
  const findings: TaskReportFinding[] = [];
  /** Quantos findings o report DECLAROU, antes de qualquer descarte. */
  let declared = 0;
  let shapeBroken = false;
  if (rawFindings === undefined || rawFindings === null) {
    // Desvio do contrato §6 (a chave é obrigatória lá), mas não é perda de
    // informação: o report não declarou finding nenhum. Fica registrado em
    // `errors` para o log e o outcome continua sendo `empty`.
    errors.push('Report sem "findings".');
  } else if (!Array.isArray(rawFindings)) {
    errors.push('"findings" não é array — ignorado.');
    shapeBroken = true;
  } else {
    declared = rawFindings.length;
    rawFindings.forEach((entry, index) => {
      const finding = normalizeFinding(entry, index, errors);
      if (finding) findings.push(finding);
    });
  }

  // `findings: []` não gera erro: report vazio é resultado válido, e tratá-lo como
  // desvio era o que fazia uma sessão sem nada a reportar virar item de dívida.
  const outcome: TaskReportOutcome =
    findings.length > 0
      ? 'ok'
      : shapeBroken || declared > 0
        ? // Declarou finding e nenhum sobreviveu: alguma coisa foi perdida no
          // caminho, e só um humano lendo o artefato bruto sabe o quê.
          'unparseable'
        : 'empty';

  const report: TaskReport = {
    macroTaskId: cleanString((envelope as Record<string, unknown>).macroTaskId),
    sessionId: cleanString((envelope as Record<string, unknown>).sessionId),
    summary: cleanString((envelope as Record<string, unknown>).summary),
    findings,
  };
  return { report, findings, errors, outcome };
}
