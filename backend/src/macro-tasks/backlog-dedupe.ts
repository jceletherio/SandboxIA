/**
 * Dedupe de findings do backlog — módulo PURO.
 *
 * "`master-agent.service.ts` é grande demais" vai aparecer em quase toda onda.
 * Sem dedupe o backlog vira uma lista de repetições e perde a informação mais
 * útil, que é QUANTAS sessões independentes viram a mesma coisa.
 *
 * Heurística deliberadamente boba (sem embedding, sem serviço externo): título
 * normalizado igual, ou títulos parecidos por Jaccard de tokens com arquivo em
 * comum. Errar para o lado de NÃO deduplicar é o erro barato — dois itens
 * parecidos no backlog é ruído, mas fundir coisas diferentes apaga informação.
 */

/** Palavras que aparecem em quase todo título e não ajudam a distinguir. */
const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na',
  'nos', 'nas', 'um', 'uma', 'para', 'por', 'com', 'sem', 'que', 'nao', 'ao',
  'the', 'of', 'to', 'in', 'is', 'it', 'and', 'or', 'not',
]);

/** Similaridade mínima de tokens quando há arquivo em comum. */
export const SIMILARITY_WITH_SHARED_FILE = 0.6;
/** Sem arquivo em comum a barra é mais alta — só título quase idêntico funde. */
export const SIMILARITY_WITHOUT_SHARED_FILE = 0.85;
/**
 * Limiar do coeficiente de sobreposição (`shared / min(|A|,|B|)`), que o Jaccard
 * não cobre: dois títulos sobre a mesma coisa costumam ter tamanhos muito
 * diferentes ("save_artifact não aceita task-report" vs. o mesmo com três
 * orações de contexto), e o Jaccard pune o título longo pelo simples fato de ser
 * longo. Calibrado nos 474 pares cruzados dos 4 reports reais da Onda 0/1: 0.60
 * pega o duplicado verdadeiro e não produz nenhum falso positivo. Abaixo disso
 * não dá para descer — em 0.44 o par verdadeiro empata com dois bugs DIFERENTES
 * do mesmo `session-runtime.service.ts`, e fundir aqueles dois apagaria um bug.
 */
export const OVERLAP_THRESHOLD = 0.6;

/**
 * Minúsculas, sem acento, sem pontuação, espaços colapsados. É a chave de
 * igualdade exata — dois títulos que só diferem em acento/case são o mesmo item.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function titleTokens(title: string): Set<string> {
  const tokens = normalizeTitle(title)
    .split(' ')
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
  // Título só de stopwords ("é o de novo") não pode virar conjunto vazio, senão
  // a similaridade daria 0 contra tudo e nunca deduplicaria.
  return new Set(tokens.length > 0 ? tokens : normalizeTitle(title).split(' ').filter(Boolean));
}

function sharedTokens(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shared = sharedTokens(a, b);
  return shared / (a.size + b.size - shared);
}

/**
 * Fração dos tokens do título MAIS CURTO que aparecem no mais longo. Insensível
 * à diferença de tamanho, ao contrário do Jaccard.
 */
export function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  return sharedTokens(a, b) / Math.min(a.size, b.size);
}

/** Compara caminhos pelo basename também: `src/a/x.ts` e `a/x.ts` são o mesmo arquivo. */
function fileKeys(file: string): string[] {
  const clean = file.trim().replace(/^\.\//, '').replace(/\\/g, '/');
  const base = clean.split('/').pop() ?? clean;
  return base && base !== clean ? [clean.toLowerCase(), base.toLowerCase()] : [clean.toLowerCase()];
}

export function hasSharedFile(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const keys = new Set(a.flatMap(fileKeys));
  return b.some((file) => fileKeys(file).some((key) => keys.has(key)));
}

export interface DedupeCandidate {
  title: string;
  files: string[];
}

/**
 * `true` quando os dois findings devem ser tratados como o MESMO item de
 * backlog. Não olha origem: quem chama já garante que a origem é diferente
 * (um report não deve deduplicar contra si mesmo).
 */
export function isDuplicateFinding(a: DedupeCandidate, b: DedupeCandidate): boolean {
  const normalizedA = normalizeTitle(a.title);
  const normalizedB = normalizeTitle(b.title);
  if (!normalizedA || !normalizedB) return false;
  if (normalizedA === normalizedB) return true;

  const tokensA = titleTokens(a.title);
  const tokensB = titleTokens(b.title);
  const threshold = hasSharedFile(a.files, b.files)
    ? SIMILARITY_WITH_SHARED_FILE
    : SIMILARITY_WITHOUT_SHARED_FILE;
  if (jaccard(tokensA, tokensB) >= threshold) return true;
  return overlapCoefficient(tokensA, tokensB) >= OVERLAP_THRESHOLD;
}

/** Primeiro candidato considerado duplicado, ou `undefined`. */
export function findDuplicate<T extends DedupeCandidate>(
  finding: DedupeCandidate,
  existing: T[],
): T | undefined {
  return existing.find((candidate) => isDuplicateFinding(finding, candidate));
}
