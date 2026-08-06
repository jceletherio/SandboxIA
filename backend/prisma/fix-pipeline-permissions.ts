import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Correção pontual de dados (MT-1, opção A aprovada via submit_question): as
 * pipelines fixas com permissionMode="acceptEdits" têm allowlist Bash só para
 * o comando nu (`pnpm build`), mas os prompts dos estágios mandam `cd backend
 * && pnpm build` / `cd frontend && pnpm build` — o CLI não casa esse prefixo
 * e a sessão desassistida trava em prompt de aprovação. Sem mudar
 * permissionMode (decisão já fechada em 03-DECISOES.md), só amplia o allowlist.
 *
 * Idempotente: só adiciona o padrão `cd <dir> && pnpm ...` que ainda não
 * existe. Roda uma vez — pipeline não é dado versionado em código como o
 * CliProfile, então isto não entra no `pnpm seed`.
 */
async function main() {
  const pipelines = await prisma.pipeline.findMany();
  let touched = 0;

  for (const pipeline of pipelines) {
    const stages = pipeline.stages as any;
    if (!stages || stages.permissionMode !== 'acceptEdits') continue;
    const permissions: string[] = Array.isArray(stages.permissions) ? stages.permissions : [];

    const added: string[] = [];
    for (const entry of permissions) {
      const match = /^Bash\(pnpm (.+)\)$/.exec(entry);
      if (!match) continue;
      const rest = match[1];
      for (const dir of ['backend', 'frontend']) {
        const withCd = `Bash(cd ${dir} && pnpm ${rest})`;
        if (!permissions.includes(withCd) && !added.includes(withCd)) added.push(withCd);
      }
    }
    if (!added.length) continue;

    await prisma.pipeline.update({
      where: { id: pipeline.id },
      data: { stages: { ...stages, permissions: [...permissions, ...added] } },
    });
    touched++;
    console.log(`✅ ${pipeline.name}: +${added.length} entrada(s) de allowlist`);
  }

  console.log(
    touched
      ? `🎉 ${touched} pipeline(s) corrigida(s).`
      : 'ℹ️ Nada para corrigir — allowlist já cobre "cd <dir> && pnpm ...".',
  );
}

main()
  .catch((e) => {
    console.error('❌ fix-pipeline-permissions failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
