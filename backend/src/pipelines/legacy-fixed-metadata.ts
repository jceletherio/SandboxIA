/**
 * Migração de dados MT-3: os 4 pipelines fixos criados nesta iniciativa
 * (Fundação/Contrato, SDD Enxuto, Feature Simples, Fix Rápido) usam a
 * convenção `[fixed · <category>]` no início da `description` em vez dos
 * campos reais `kind`/`category` do contrato MT-0. Módulo PURO (sem Prisma):
 * só sabe reconhecer o prefixo e devolver a description limpa + a categoria.
 */
export interface LegacyFixedMetadata {
  category: string;
  description: string;
}

const FIXED_PREFIX_RE = /^\[fixed\s*·\s*([a-z0-9][a-z0-9-]*)\]\s*/i;

/**
 * Devolve `null` quando a description não tem o prefixo legado — é o caso
 * comum (pipeline customizada, ou fixa já migrada) e não é erro nenhum.
 */
export function parseLegacyFixedMetadata(
  description: string | null | undefined,
): LegacyFixedMetadata | null {
  if (typeof description !== 'string') return null;
  const match = description.match(FIXED_PREFIX_RE);
  if (!match) return null;
  return {
    category: match[1].toLowerCase(),
    description: description.slice(match[0].length),
  };
}
