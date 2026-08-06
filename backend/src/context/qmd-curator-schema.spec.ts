import * as fs from 'fs';
import * as path from 'path';

/**
 * `schemas.md` diz "falha de validação = teste vermelho", mas nenhum código
 * carregava o schema do `qmd-curator` — então a divergência entre o que o agente
 * emite e o que o contrato aceita ficou viva desde a MT-6, invisível.
 *
 * Este teste fecha o buraco pelos dois lados: valida contra o schema o exemplo
 * de saída que está **dentro do próprio `qmd-curator.md`**, extraído do arquivo
 * em vez de copiado para cá. Editar o exemplo no agente sem editar o schema (ou
 * o contrário) fica vermelho aqui — que era exatamente o modo de falha.
 *
 * Sem `ajv`: resolve no `node_modules` compartilhado com outros worktrees, mas
 * não é dependência declarada do backend, e declará-la exigiria `pnpm install`
 * (proibido na sessão — árvore compartilhada, ver `01-CONTRATOS.md` §7). Em vez
 * de um validador genérico, `matchesSchema` cobre só o subconjunto de draft-07
 * que os schemas deste repo usam (object/string/array/integer, required, enum,
 * additionalProperties, minimum, items) — o bastante para pegar a divergência
 * real, sem puxar dependência nova.
 *
 * Mora no backend porque é o único jest do repo; não tem dependência de Nest.
 */
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, '.claude/skills/sdd/schemas/qmd-curator-output.schema.json');
const AGENT_PATH = path.join(REPO_ROOT, '.claude/agents/qmd-curator.md');

/** Valida `value` contra o subconjunto de draft-07 usado nos schemas do repo. */
function matchesSchema(schema: any, value: unknown): string[] {
  const errors: string[] = [];
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return ['não é um objeto'];
    }
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`falta "${key}"`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in (schema.properties ?? {}))) errors.push(`campo desconhecido "${key}"`);
      }
    }
    for (const [key, propSchema] of Object.entries<any>(schema.properties ?? {})) {
      if (key in obj) errors.push(...matchesSchema(propSchema, obj[key]).map((e) => `${key}: ${e}`));
    }
    return errors;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return ['não é um array'];
    return value.flatMap((item, i) => matchesSchema(schema.items, item).map((e) => `[${i}] ${e}`));
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return ['não é um inteiro'];
    if (typeof schema.minimum === 'number' && (value as number) < schema.minimum) {
      errors.push(`menor que o mínimo (${schema.minimum})`);
    }
    return errors;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return ['não é uma string'];
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`"${value}" fora do enum [${schema.enum.join(', ')}]`);
    }
    return errors;
  }
  return errors;
}

/** O exemplo no agente é `jsonc` (tem comentário de enum na linha do fecho). */
function readAgentExample(): unknown {
  const md = fs.readFileSync(AGENT_PATH, 'utf8');
  const fence = /```jsonc\n([\s\S]*?)```/.exec(md);
  if (!fence) throw new Error(`Nenhum bloco jsonc em ${AGENT_PATH} — o exemplo de saída sumiu`);
  // `(?<!:)` preserva `qmd://…` caso um exemplo futuro use URI de coleção.
  return JSON.parse(fence[1].replace(/(?<!:)\/\/[^\n]*/g, ''));
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

describe('qmd-curator-output.schema.json', () => {
  it('aceita o exemplo de saída documentado no próprio qmd-curator.md', () => {
    // Imprime os erros: "falta recommendation" é bem mais útil que "false".
    expect(matchesSchema(schema, readAgentExample())).toEqual([]);
  });

  it('aceita `recommendation` nos três valores que o agente pode emitir', () => {
    for (const recommendation of ['none', 'ask-orchestrator-to-reindex', 'fallback-to-grep']) {
      const errors = matchesSchema(schema, {
        mode: 'health',
        collections: ['onequest-docs', 'onequest-code'],
        vectors: 440,
        pending: 234,
        health: 'amarelo',
        recommendation,
      });
      expect(errors).toEqual([]);
    }
  });

  it('rejeita os modos setup/refresh, removidos do agente junto com a escrita no índice', () => {
    const errors = matchesSchema(schema, {
      mode: 'refresh',
      collections: [],
      vectors: 0,
      pending: 0,
      health: 'vermelho',
      recommendation: 'fallback-to-grep',
    });

    expect(errors).not.toEqual([]);
  });

  it('rejeita campo desconhecido — o contrato é fechado de propósito', () => {
    const errors = matchesSchema(schema, {
      mode: 'health',
      collections: [],
      vectors: 0,
      pending: 0,
      health: 'vermelho',
      recommendation: 'none',
      reindexed: true,
    });

    expect(errors).toEqual(['campo desconhecido "reindexed"']);
  });
});
