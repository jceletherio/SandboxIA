/**
 * Diagnóstico de `node_modules` inconsistente com o `package.json` que ele
 * deveria satisfazer.
 *
 * Motivo de existir: com `backend/node_modules` symlinkado do repo principal
 * para todo worktree (01-CONTRATOS §7), uma instalação parcial no repo
 * principal — install interrompido, duas ondas paralelas escrevendo no mesmo
 * `.pnpm` store ao mesmo tempo — quebra a TODOS os worktrees ao mesmo tempo, e
 * quebra silenciosamente: `provisionWorktree` só sabia dizer "linkei", nunca
 * "linkei algo furado". Achado real (MT-22): `jest` chegou a existir no
 * `.pnpm` store do repo principal sem nunca ter sido linkado em
 * `node_modules/jest`, e toda sessão que rodava `pnpm test` só via
 * `jest: not found`, sem pista de que a causa era compartilhada.
 *
 * Módulo puro de propósito (nada de fs aqui): quem chama já fez o
 * `readdir`/`readFile` e passa o resultado como dado, do mesmo jeito que
 * `git-dirty.ts` recebe um `StatusResult` em vez de rodar `git` internamente.
 * Isso o torna testável sem tocar disco e serve de contrato para qualquer
 * checagem de integridade futura em `workspace/`.
 */

/** Subconjunto de `package.json` que este módulo lê. */
export interface PackageManifestLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** O que já foi observado em disco pelo chamador, sem re-tocar o filesystem aqui. */
export interface NodeModulesSnapshot {
  /** Nomes de pacote top-level (`"jest"`, `"@nestjs/testing"`) achados em `node_modules`. */
  present: string[];
}

/** Nomes de pacote declarados em `dependencies` + `devDependencies`, sem duplicar. */
export function declaredPackages(pkg: PackageManifestLike | null | undefined): string[] {
  const deps = pkg?.dependencies ?? {};
  const devDeps = pkg?.devDependencies ?? {};
  return [...new Set([...Object.keys(deps), ...Object.keys(devDeps)])];
}

/**
 * Pacotes declarados no `package.json` que não aparecem no snapshot do
 * `node_modules`. Ordem preservada (a de `declaredPackages`) para a mensagem
 * de warning sair estável.
 */
export function missingPackages(
  pkg: PackageManifestLike | null | undefined,
  snapshot: NodeModulesSnapshot | null | undefined,
): string[] {
  const present = new Set(snapshot?.present ?? []);
  return declaredPackages(pkg).filter((name) => !present.has(name));
}

/** `true` quando todo pacote declarado está presente no snapshot. */
export function isNodeModulesConsistent(
  pkg: PackageManifestLike | null | undefined,
  snapshot: NodeModulesSnapshot | null | undefined,
): boolean {
  return missingPackages(pkg, snapshot).length === 0;
}
