/**
 * Parser da saída de `qmd status`.
 *
 * O CLI não tem `--json` na v2.5.2 — a única fonte do estado do índice é o texto
 * formatado para humano. Isolar isso aqui, num arquivo com teste sobre a saída
 * real capturada, é o que faz uma mudança de layout do CLI virar teste vermelho
 * em vez de estado silenciosamente errado na /context: `documents: 0` porque o
 * CLI trocou "Total:" por outro rótulo é indistinguível de índice vazio.
 *
 * Não lança: campo ausente vira 0/`null`. Quem decide o que fazer com índice
 * zerado é o `freshnessOf` do QmdEmbedService, não o parser.
 */
export interface QmdStatusSnapshot {
  collections: string[];
  documents: number;
  vectors: number;
  /** Docs indexados ainda SEM embedding — o CLI imprime "Pending: N need embedding". */
  pending: number;
  /** Rótulo cru ("37m ago") — o CLI não expõe timestamp. */
  updatedLabel: string | null;
}

/** Rótulos do bloco "Documents", todos no formato `Rótulo:  <n> <texto livre>`. */
function readCount(stdout: string, label: string): number {
  const match = stdout.match(new RegExp(`^\\s*${label}:\\s+(\\d+)`, 'm'));
  return match ? Number(match[1]) : 0;
}

export function parseQmdStatus(stdout: string): QmdStatusSnapshot {
  return {
    // `^\s{2}` ancora no recuo do bloco "Collections": sem a âncora de início de
    // linha, o `qmd://` dos exemplos de uso no fim da saída entraria na lista.
    collections: [...stdout.matchAll(/^\s{2}(\S+)\s+\(qmd:\/\//gm)].map((m) => m[1]),
    documents: readCount(stdout, 'Total'),
    vectors: readCount(stdout, 'Vectors'),
    pending: readCount(stdout, 'Pending'),
    updatedLabel: stdout.match(/^\s*Updated:\s+(.+)/m)?.[1]?.trim() ?? null,
  };
}
