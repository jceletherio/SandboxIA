import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

export interface GitBranchInfo {
  name: string;
  current: boolean;
  merged: boolean;
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  } | null;
  aheadBehind: { ahead: number; behind: number } | null;
}

export interface GitOverview {
  repoPath: string;
  currentBranch: string;
  mainBranch: string;
  branches: GitBranchInfo[];
  worktrees: Array<{ worktree: string; branch?: string; HEAD?: string }>;
  recentMerges: Array<{ hash: string; message: string; author: string; date: string }>;
}

const MAX_BRANCHES = 50;
const MAX_AHEAD_BEHIND = 20;

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  constructor(
    private prisma: PrismaService,
    private workspace: WorkspaceService,
  ) {}

  private async resolveRepo(projectId: string): Promise<{ git: SimpleGit; repoPath: string; mainBranch: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (!project.mainPath || !fs.existsSync(project.mainPath)) {
      throw new BadRequestException(`Project mainPath does not exist: ${project.mainPath}`);
    }
    const git = simpleGit(project.mainPath);
    if (!(await git.checkIsRepo())) {
      throw new BadRequestException(`Project mainPath is not a git repository: ${project.mainPath}`);
    }

    const settings = (project.settings as any) || {};
    let mainBranch: string = settings.mainBranch;
    if (!mainBranch) {
      const local = await git.branchLocal();
      mainBranch = ['main', 'master', 'develop'].find((b) => local.all.includes(b)) || local.current;
    }
    return { git, repoPath: project.mainPath, mainBranch };
  }

  async overview(projectId: string): Promise<GitOverview> {
    const { git, repoPath, mainBranch } = await this.resolveRepo(projectId);

    const [local, worktrees, mergedRaw, mergesLog] = await Promise.all([
      git.branchLocal(),
      this.workspace.listWorktrees(repoPath).catch(() => []),
      git.raw(['branch', '--merged', mainBranch]).catch(() => ''),
      git
        .log(['--merges', '-n', '20', mainBranch])
        .catch(() => ({ all: [] as any[] })),
    ]);

    const mergedSet = new Set(
      mergedRaw
        .split('\n')
        .map((l) => l.replace(/^[*+\s]+/, '').trim())
        .filter(Boolean),
    );

    // Últimos commits por branch em UMA chamada (for-each-ref), sem N+1 de git log
    const refsRaw = await git
      .raw([
        'for-each-ref',
        'refs/heads',
        '--sort=-committerdate',
        `--count=${MAX_BRANCHES}`,
        '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:iso8601)%09%(authorname)%09%(subject)',
      ])
      .catch(() => '');
    const lastCommitByBranch = new Map<string, GitBranchInfo['lastCommit']>();
    const orderedBranches: string[] = [];
    for (const line of refsRaw.split('\n')) {
      if (!line.trim()) continue;
      const [name, hash, date, author, ...subject] = line.split('\t');
      orderedBranches.push(name);
      lastCommitByBranch.set(name, { hash, date, author, message: subject.join('\t') });
    }

    const branches: GitBranchInfo[] = [];
    for (const name of orderedBranches) {
      let aheadBehind: GitBranchInfo['aheadBehind'] = null;
      // ahead/behind só para as branches mais recentes (evita custo em repos grandes)
      if (name !== mainBranch && branches.length < MAX_AHEAD_BEHIND) {
        try {
          const counts = await git.raw(['rev-list', '--left-right', '--count', `${mainBranch}...${name}`]);
          const [behind, ahead] = counts.trim().split(/\s+/).map((n) => parseInt(n, 10));
          aheadBehind = { ahead: ahead || 0, behind: behind || 0 };
        } catch {
          aheadBehind = null;
        }
      }
      branches.push({
        name,
        current: name === local.current,
        merged: name !== mainBranch && mergedSet.has(name),
        lastCommit: lastCommitByBranch.get(name) ?? null,
        aheadBehind,
      });
    }

    return {
      repoPath,
      currentBranch: local.current,
      mainBranch,
      branches,
      worktrees,
      recentMerges: (mergesLog.all as any[]).map((c) => ({
        hash: (c.hash as string).slice(0, 8),
        message: c.message,
        author: c.author_name,
        date: c.date,
      })),
    };
  }

  /** Log de commits de uma branch (ou da main) — para histórico na UI. */
  async log(projectId: string, branch?: string, limit = 30) {
    const { git, mainBranch } = await this.resolveRepo(projectId);
    const target = branch || mainBranch;
    const log = await git.log([target, '-n', String(Math.min(limit, 100))]);
    return log.all.map((c) => ({
      hash: c.hash.slice(0, 8),
      message: c.message,
      author: c.author_name,
      date: c.date,
      refs: c.refs,
    }));
  }

  /** Diff-stat de uma branch contra a main — pré-visualização antes do merge. */
  async diff(projectId: string, branch: string) {
    if (!branch) throw new BadRequestException('branch is required');
    const { git, mainBranch } = await this.resolveRepo(projectId);
    const [stat, nameStatus] = await Promise.all([
      git.raw(['diff', '--shortstat', `${mainBranch}...${branch}`]).catch(() => ''),
      git.raw(['diff', '--name-status', `${mainBranch}...${branch}`]).catch(() => ''),
    ]);
    const files = nameStatus
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split('\t');
        return { status: status.trim(), path: pathParts.join('\t') };
      });
    return { base: mainBranch, branch, shortstat: stat.trim(), files };
  }
}
