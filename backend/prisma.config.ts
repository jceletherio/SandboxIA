import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Substitui `package.json#prisma` (removido em Prisma 7). O bloco antigo só
// tinha `seed`; `schema` é implícito (`prisma/schema.prisma`) mas fica
// explícito aqui porque é o caminho de leitura oficial do config novo.
//
// Com `prisma.config.ts` presente, o Prisma CLI PARA de carregar `.env`
// sozinho (verificado: `prisma migrate status` sem DATABASE_URL exportada
// falha com P1012). `docs/guides/acesso-banco-e-api.md` documenta o
// `ts-node -e "PrismaClient..."` das sessões contando com esse auto-load —
// sem isto, todo comando `prisma <algo>` (e o próprio guia) quebra exigindo
// export manual. `process.loadEnvFile` é nativo do Node (>=20.6), sem
// dependência nova.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // sem .env (ambiente que já exporta as vars, ex.: CI) — não é erro
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});
