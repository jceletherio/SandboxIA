/**
 * Renderização pura dos templates declarativos de CliProfile.
 * Placeholders suportados: {{prompt}}, {{model}}, {{mcpConfigPath}},
 * {{url}}, {{token}}, {{resumeId}}, {{sessionId}}.
 */

export interface RenderContext {
  prompt?: string;
  model?: string;
  mcpConfigPath?: string;
  url?: string;
  token?: string;
  resumeId?: string;
  sessionId?: string;
  /** Modo de permissão do CLI (ex.: acceptEdits, bypassPermissions). */
  permissionMode?: string;
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

function renderString(template: string, ctx: RenderContext): { value: string; unresolved: boolean } {
  let unresolved = false;
  const value = template.replace(PLACEHOLDER_RE, (_match, key: string) => {
    const replacement = (ctx as Record<string, string | undefined>)[key];
    if (replacement === undefined || replacement === null || replacement === '') {
      unresolved = true;
      return '';
    }
    return replacement;
  });
  return { value, unresolved };
}

/**
 * Renderiza uma lista de args. Args cujo placeholder não foi resolvido são
 * descartados junto com a flag imediatamente anterior (ex.: sem model,
 * `--model {{model}}` some inteiro em vez de virar `--model ""`).
 */
export function renderArgs(args: string[], ctx: RenderContext): string[] {
  const result: string[] = [];
  for (const arg of args) {
    const { value, unresolved } = renderString(arg, ctx);
    if (unresolved) {
      const prev = result[result.length - 1];
      if (prev !== undefined && prev.startsWith('-')) {
        result.pop();
      }
      continue;
    }
    result.push(value);
  }
  return result;
}

/** Renderiza recursivamente um JSON de template (config MCP, env, etc.). */
export function renderJson<T>(template: T, ctx: RenderContext): T {
  if (typeof template === 'string') {
    return renderString(template, ctx).value as unknown as T;
  }
  if (Array.isArray(template)) {
    return template.map((item) => renderJson(item, ctx)) as unknown as T;
  }
  if (template !== null && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      out[key] = renderJson(value, ctx);
    }
    return out as T;
  }
  return template;
}

/**
 * Quote seguro para montar a linha de comando colada no pane.
 *
 * As duas famílias de shell escapam aspa simples de formas incompatíveis:
 * POSIX fecha/reabre a string (`'\''`), PowerShell DOBRA a aspa (`''`). Usar a
 * regra POSIX no PowerShell quebra o parse — `'C:\Users\O'\''Brien\x'` vira
 * string + `\` + string solta. Só aparece quando o argumento tem aspa simples
 * (um caminho de perfil com apóstrofo no nome do usuário, tipicamente), que é
 * exatamente o caso que ninguém testa e que derruba o boot do CLI com um erro
 * ilegível.
 *
 * Barra invertida não precisa de tratamento: dentro de aspas simples, nem o
 * PowerShell nem o POSIX a interpretam — é o que faz caminho de Windows
 * sobreviver à colagem.
 */
export function shellQuote(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (/^[A-Za-z0-9_\-./=:@%+]+$/.test(arg)) return arg;
  if (platform === 'win32') return `'${arg.replace(/'/g, "''")}'`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function buildCommandLine(
  binary: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const quotedBinary = shellQuote(binary, platform);
  // No PowerShell, uma string entre aspas na posição de comando é uma
  // EXPRESSÃO — a linha só ecoaria o caminho em vez de executá-lo. O operador
  // de chamada `&` é o que a transforma em comando. Só faz sentido quando o
  // binário precisou de aspas (caminho com espaço); nome simples dispensa.
  const prefix = platform === 'win32' && quotedBinary !== binary ? '& ' : '';
  return prefix + [quotedBinary, ...args.map((a) => shellQuote(a, platform))].join(' ');
}
