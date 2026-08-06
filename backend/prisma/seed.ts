import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Perfis built-in de CLI. Tudo declarativo: placeholders {{prompt}}, {{model}},
// {{mcpConfigPath}}, {{url}}, {{token}} são renderizados pelo CliProfileRenderer.
const cliProfiles = [
  {
    name: 'claude',
    binary: 'claude',
    interactiveArgs: [
      // SEM --strict-mcp-config: a sessão HERDA os MCPs do usuário (plugins,
      // conectores já autenticados, ex. Figma) e do projeto (.mcp.json);
      // o --mcp-config só ADICIONA o servidor do orchestrator por cima.
      '--mcp-config',
      '{{mcpConfigPath}}',
      '--model',
      '{{model}}',
      // MT-1: placeholder restaurado. O allowlist das 4 pipelines fixas com
      // permissionMode="acceptEdits" foi corrigido em paralelo (ver
      // fix-pipeline-permissions.ts e 03-DECISOES.md) para casar com os
      // prompts reais — sem essa correção, restaurar isto travaria sessão
      // desassistida em prompt de Bash.
      '--permission-mode',
      '{{permissionMode}}',
    ],
    resumeArgs: ['--resume', '{{resumeId}}'],
    mcpConfigFile: '.orchestrator/mcp.json',
    mcpConfigTemplate: {
      mcpServers: {
        orchestrator: {
          type: 'http',
          url: '{{url}}',
          headers: { Authorization: 'Bearer {{token}}' },
        },
      },
    },
    env: null,
    defaultModel: 'sonnet',
    builtin: true,
  },
  {
    name: 'opencode',
    binary: 'opencode',
    // opencode carrega opencode.json da raiz do worktree automaticamente;
    // modelo e MCP vêm do arquivo de config.
    interactiveArgs: [],
    resumeArgs: null,
    mcpConfigFile: 'opencode.json',
    mcpConfigTemplate: {
      $schema: 'https://opencode.ai/config.json',
      model: '{{model}}',
      mcp: {
        orchestrator: {
          type: 'remote',
          url: '{{url}}',
          enabled: true,
          headers: { Authorization: 'Bearer {{token}}' },
        },
      },
      permission: { edit: 'allow', bash: 'allow' },
    },
    env: null,
    defaultModel: 'anthropic/claude-sonnet-4-5',
    builtin: true,
  },
];

// Modelos que alimentam os selects de `/settings` (defaults.model/masterModel) e
// `PhaseModelAssignment`. Sem @unique em provider+name — upsert manual por
// findFirst para não duplicar a cada `pnpm seed`.
const llmModels = [
  { provider: 'anthropic', name: 'sonnet', contextSize: 200_000, enabled: true },
  { provider: 'anthropic', name: 'opus', contextSize: 200_000, enabled: true },
  { provider: 'anthropic', name: 'haiku', contextSize: 200_000, enabled: true },
];

async function main() {
  console.log('🌱 Starting seed...');

  for (const profile of cliProfiles) {
    await prisma.cliProfile.upsert({
      where: { name: profile.name },
      update: profile as any,
      create: profile as any,
    });
    console.log(`✅ CLI profile: ${profile.name}`);
  }

  for (const model of llmModels) {
    const existing = await prisma.lLMModel.findFirst({
      where: { provider: model.provider, name: model.name },
    });
    if (!existing) {
      await prisma.lLMModel.create({ data: model });
      console.log(`✅ LLM model: ${model.provider}/${model.name}`);
    }
  }

  const existingProject = await prisma.project.findFirst({
    where: { name: 'TodoList App' },
  });
  if (existingProject) {
    console.log('ℹ️ Demo project already exists, skipping demo seed.');
    return;
  }

  const project = await prisma.project.create({
    data: {
      name: 'TodoList App',
      description: 'Simple todo list application for testing the Orchestrator platform',
      repoUrl: 'file:///tmp/test-projects/todolist-app',
      mainPath: '/tmp/test-projects/todolist-app',
      worktreeBase: '/tmp/worktrees',
    },
  });

  console.log(`✅ Created project: ${project.name} (${project.id})`);

  const pipeline = await prisma.pipeline.create({
    data: {
      projectId: project.id,
      name: 'SDD (Spec-Driven Development)',
      description: '8-stage pipeline: Discovery → Q&A → Spec → Tasks → Impl → Review → Tests → Merge',
      isActive: true,
      stages: {
        stages: [
          { name: 'Discovery', agent: 'discovery', timeout: 30, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Q&A', agent: 'qa', timeout: 60, onQuestion: 'pause', mode: 'interactive' },
          { name: 'Specification', agent: 'specification', timeout: 45, onQuestion: 'pause', mode: 'interactive' },
          { name: 'Task Breakdown', agent: 'task-breakdown', timeout: 20, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Implementation', agent: 'implementation', timeout: 120, onQuestion: 'pause', mode: 'interactive' },
          { name: 'Review', agent: 'review', timeout: 30, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Tests', agent: 'tests', timeout: 30, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Merge', agent: 'merge', timeout: 10, onQuestion: 'continue', mode: 'engine' },
        ],
      },
    },
  });

  console.log(`✅ Created pipeline: ${pipeline.name} (${pipeline.id})`);

  const opencodeProfile = await prisma.cliProfile.findUnique({ where: { name: 'opencode' } });
  const claudeProfile = await prisma.cliProfile.findUnique({ where: { name: 'claude' } });

  const agent = await prisma.agent.create({
    data: {
      projectId: project.id,
      name: 'OpenCode Agent',
      type: 'opencode',
      model: 'default',
      status: 'idle',
      cliProfileId: opencodeProfile?.id,
    },
  });

  await prisma.agent.create({
    data: {
      projectId: project.id,
      name: 'Claude Code Agent',
      type: 'claude',
      model: 'sonnet',
      status: 'idle',
      cliProfileId: claudeProfile?.id,
    },
  });

  console.log(`✅ Created agents (opencode + claude)`);

  const macroTask = await prisma.macroTask.create({
    data: {
      projectId: project.id,
      pipelineId: pipeline.id,
      title: 'Implement Todo CRUD',
      description: 'Create a simple todo list with add, remove, and mark complete functionality',
      status: 'pending',
      priority: 1,
    },
  });

  console.log(`✅ Created macro task: ${macroTask.title} (${macroTask.id})`);

  console.log('\n🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
