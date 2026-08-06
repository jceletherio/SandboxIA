// Flat config do eslint 9 alinhada ao Next 16.2.6 (mesma versão do `next` no
// package.json). Requer as devDependencies `eslint@^9.39.5` e
// `eslint-config-next@16.2.6` — instaladas no checkout principal, não no
// worktree (ver docs/melhorias/decisoes/mt-14.md).
//
// O piso do eslint não é decorativo: `defineConfig`/`globalIgnores` vêm do
// subpath `eslint/config`, que não existe nos 9.x iniciais. Verificado no
// 9.39.4; com `^9` cru um `pnpm install` podia trazer um 9.0 e derrubar o lint
// com ERR_MODULE_NOT_FOUND na própria config.
//
// Os subpaths `core-web-vitals` e `typescript` já vêm como flat config no
// eslint-config-next 16; não é preciso FlatCompat nem @eslint/eslintrc.
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'public/**']),

  {
    // Dívida PREEXISTENTE, não licença para código novo. Estas 4 regras pegam
    // 203 violações em 30 arquivos que já estavam no repo antes desta config
    // existir — e a maioria desses arquivos pertence a outras tasks no mapa de
    // propriedade do 00-PLANO. Rebaixar para `warn` é o que faz `pnpm lint`
    // sair com exit 0 sem tocar em arquivo de terceiro; o resto do preset
    // continua `error`, então quebra nova ainda barra o comando.
    //
    // O teto de `--max-warnings` no script `lint` (package.json) é o que impede
    // esta dívida de crescer: era `eslint .` puro, que saía 0 com 220 warnings e
    // sairia 0 com 400. Ao quitar uma regra, apague a linha aqui E baixe o teto.
    //
    // Contagem por regra e o plano de quitação estão no report da MT-14.
    // `preserve-manual-memoization` e `purity` saíram na MT-25 (1 violação cada,
    // as duas eram bug real) e voltaram a ser `error` do preset.
    //
    // `any` e `set-state-in-effect` subiram (149→151, 19→21) num rebase sobre
    // main já dentro da MT-25: merges paralelos (MT-13/15/22/23/24) tocaram
    // arquivos desta lista antes do teto existir em main. Ver
    // decisoes/mt-25.md.
    name: 'orchestr/divida-preexistente',
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn', // 151 ocorrências
      'react-hooks/set-state-in-effect': 'warn', // 21
      'react-hooks/refs': 'warn', // 19
      'react/no-unescaped-entities': 'warn', // 12
    },
  },
])
