/**
 * Critério ÚNICO de "repo sujo o suficiente para barrar um merge".
 *
 * Motivo de existir: `StatusResult.files` do simple-git inclui arquivo NÃO
 * rastreado (`index === '?' && working_dir === '?'`). O gate do `mergeToMain`
 * usava `files.length > 0` e por isso 5 arquivos untracked em `.opencode/agent/`
 * no repo principal derrubaram o merge de TODAS as sessões — nenhuma delas tinha
 * relação com aqueles arquivos. Untracked não participa de merge: o git não os
 * lê, não os sobrescreve e não gera conflito com eles.
 *
 * Módulo puro de propósito (nada de Nest, nada de simple-git em runtime): é
 * testável sem git de verdade e serve como contrato para qualquer gate futuro.
 * Se você for escrever outra checagem de "repo limpo" no workspace/, use
 * `hasTrackedChanges` — não `status.files.length`.
 */

/** Subconjunto de `FileStatusResult` (simple-git) que este módulo usa. */
export interface GitFileStatus {
  path: string;
  /** Código do índice (staged). `?` = untracked, `!` = ignorado, ` ` = sem mudança. */
  index: string;
  /** Código da árvore de trabalho. Mesma convenção do `index`. */
  working_dir: string;
}

/** Subconjunto de `StatusResult` (simple-git) que este módulo usa. */
export interface GitStatusLike {
  files: GitFileStatus[];
}

/** `?` nas duas colunas = untracked; `!` = ignorado (só aparece com --ignored). */
const UNTRACKED_CODES = new Set(['?', '!']);

function isTracked(file: GitFileStatus): boolean {
  const index = file?.index ?? '';
  const workingDir = file?.working_dir ?? '';
  // O git marca as DUAS colunas para untracked/ignorado. Basta uma coluna com
  // código real (M, A, D, R, C, U) para o arquivo estar sob controle de versão.
  //
  // Entrada malformada (códigos ausentes) cai aqui como RASTREADA — de propósito,
  // e é o oposto do que `trackedChangedFiles` faz com um `status` inteiro sem
  // `files`. A assimetria é deliberada: se o git reportou um arquivo mas não
  // conseguimos classificá-lo, barrar o merge é o erro reversível (alguém lê a
  // mensagem e resolve); deixar passar sobrescreveria trabalho não commitado.
  // Já um `status` sem `files` não veio do git — não há arquivo nenhum para
  // proteger, e barrar ali travaria o merge de todas as sessões, que é justamente
  // o bug que este módulo existe para consertar.
  return !(UNTRACKED_CODES.has(index) && UNTRACKED_CODES.has(workingDir));
}

/**
 * Caminhos com mudança RASTREADA: staged, modificado, deletado, renomeado,
 * copiado ou em conflito. Arquivo untracked/ignorado fica de fora.
 *
 * Ordem preservada (é a do `git status`) para a mensagem de erro sair estável.
 */
export function trackedChangedFiles(status: GitStatusLike | null | undefined): string[] {
  const files = status?.files;
  if (!Array.isArray(files)) return [];
  return files.filter(isTracked).map((file) => file.path);
}

/** `true` quando existe mudança rastreada — o único caso que impede um merge. */
export function hasTrackedChanges(status: GitStatusLike | null | undefined): boolean {
  return trackedChangedFiles(status).length > 0;
}
