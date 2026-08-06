import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * GitHub access in this project goes through the `gh` CLI already authenticated on the machine —
 * no PAT, no GitHub App, no token stored anywhere. Same CLI-only stance as the agent runtimes.
 *
 * SECURITY: every `gh` invocation uses `execFile` with an ARGUMENT ARRAY and never `shell: true`,
 * so user input can never be interpreted by a shell. On top of that, `repo` is matched against a
 * strict allowlist regex before it reaches the CLI.
 */

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const LABEL_PATTERN = /^[^\n\r]{1,100}$/;
const GH_TIMEOUT_MS = 20_000;
const GH_MAX_BUFFER = 32 * 1024 * 1024;
const ISSUE_STATES = ['open', 'closed', 'all'] as const;
const DEFAULT_ISSUE_LIMIT = 50;
const MAX_ISSUE_LIMIT = 200;

export type IssueState = (typeof ISSUE_STATES)[number];

export interface GithubCliStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  account?: string;
  message?: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  state: string;
}

interface ExecError extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: string;
  stdout?: string;
  stderr?: string;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  /**
   * Cheap probe so the UI can warn before the user tries to import anything.
   * Never throws — an unusable `gh` is a normal, reportable state here.
   */
  async status(): Promise<GithubCliStatus> {
    let version: string | undefined;
    try {
      const { stdout } = await execFileAsync('gh', ['--version'], {
        timeout: GH_TIMEOUT_MS,
        maxBuffer: GH_MAX_BUFFER,
      });
      version = stdout.split('\n')[0]?.trim() || undefined;
    } catch (error) {
      const err = error as ExecError;
      this.logger.warn(`gh --version failed: ${err.message}`);
      return {
        installed: false,
        authenticated: false,
        message:
          'The GitHub CLI (gh) is not installed on this machine. Install it and run "gh auth login" to import issues.',
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync('gh', ['auth', 'status'], {
        timeout: GH_TIMEOUT_MS,
        maxBuffer: GH_MAX_BUFFER,
      });
      return {
        installed: true,
        authenticated: true,
        version,
        account: this.parseAccount(`${stdout}\n${stderr}`),
      };
    } catch (error) {
      const err = error as ExecError;
      this.logger.warn(`gh auth status failed: ${err.message}`);
      return {
        installed: true,
        authenticated: false,
        version,
        message:
          'The GitHub CLI is installed but not authenticated. Run "gh auth login" on this machine to import issues.',
      };
    }
  }

  async listIssues(params: {
    repo?: string;
    state?: string;
    limit?: number;
    labels?: string;
  }): Promise<GithubIssue[]> {
    const repo = (params.repo ?? '').trim();
    if (!repo) {
      throw new BadRequestException('Provide the repository to read, in the "owner/name" format.');
    }
    if (!REPO_PATTERN.test(repo)) {
      throw new BadRequestException(
        `Invalid repository "${repo}". Use the "owner/name" format — only letters, digits, ".", "_" and "-" are allowed.`,
      );
    }

    const state = (params.state ?? 'open').trim().toLowerCase();
    if (!ISSUE_STATES.includes(state as IssueState)) {
      throw new BadRequestException(
        `Invalid state "${state}". Use one of: ${ISSUE_STATES.join(', ')}.`,
      );
    }

    const rawLimit = Number(params.limit ?? DEFAULT_ISSUE_LIMIT);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_ISSUE_LIMIT)
      : DEFAULT_ISSUE_LIMIT;

    const labels = (params.labels ?? '')
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const label of labels) {
      if (!LABEL_PATTERN.test(label)) {
        throw new BadRequestException(`Invalid label "${label}".`);
      }
    }

    const args = [
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      state,
      '--limit',
      String(limit),
      '--json',
      'number,title,body,url,labels,state',
    ];
    for (const label of labels) {
      args.push('--label', label);
    }

    let stdout: string;
    try {
      const result = await execFileAsync('gh', args, {
        timeout: GH_TIMEOUT_MS,
        maxBuffer: GH_MAX_BUFFER,
      });
      stdout = result.stdout;
    } catch (error) {
      throw this.toHttpException(error as ExecError, repo);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stdout || '[]');
    } catch {
      throw new HttpException(
        'The GitHub CLI returned a response that could not be parsed as JSON.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new HttpException(
        'The GitHub CLI returned an unexpected response shape for the issue list.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return parsed.map((issue) => this.normalizeIssue(issue));
  }

  private normalizeIssue(issue: any): GithubIssue {
    const labels = Array.isArray(issue?.labels)
      ? issue.labels
          .map((l: any) => (typeof l === 'string' ? l : l?.name))
          .filter((l: any): l is string => typeof l === 'string' && l.length > 0)
      : [];
    return {
      number: typeof issue?.number === 'number' ? issue.number : 0,
      title: typeof issue?.title === 'string' ? issue.title : '',
      body: typeof issue?.body === 'string' ? issue.body : '',
      url: typeof issue?.url === 'string' ? issue.url : '',
      labels,
      state: typeof issue?.state === 'string' ? issue.state.toLowerCase() : 'unknown',
    };
  }

  private parseAccount(output: string): string | undefined {
    const match = output.match(/Logged in to \S+ account (\S+)/);
    return match?.[1];
  }

  /** Turns a raw `gh` failure into an actionable HTTP error instead of leaking a stack trace. */
  private toHttpException(err: ExecError, repo: string): HttpException {
    const stderr = (err.stderr ?? '').trim();
    const haystack = `${stderr}\n${err.message ?? ''}`.toLowerCase();

    if (err.code === 'ENOENT') {
      return new HttpException(
        'The GitHub CLI (gh) is not installed on this machine. Install it and run "gh auth login" to import issues.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
      return new HttpException(
        `The GitHub CLI timed out after ${GH_TIMEOUT_MS / 1000}s while listing issues of "${repo}". Check your network and try a smaller limit.`,
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }

    if (
      haystack.includes('gh auth login') ||
      haystack.includes('not logged in') ||
      haystack.includes('authentication required') ||
      haystack.includes('bad credentials')
    ) {
      return new HttpException(
        'The GitHub CLI is not authenticated. Run "gh auth login" on this machine and try again.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (
      haystack.includes('could not resolve to a repository') ||
      haystack.includes('http 404') ||
      haystack.includes('not found')
    ) {
      return new HttpException(
        `Repository "${repo}" was not found, or the authenticated GitHub account has no access to it.`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (haystack.includes('http 403') || haystack.includes('must have push access')) {
      return new HttpException(
        `The authenticated GitHub account is not allowed to read issues of "${repo}".`,
        HttpStatus.FORBIDDEN,
      );
    }

    this.logger.error(`gh issue list failed for ${repo}: ${stderr || err.message}`);
    const detail = (stderr || err.message || '').split('\n')[0]?.trim();
    return new HttpException(
      `The GitHub CLI failed while listing issues of "${repo}"${detail ? `: ${detail}` : '.'}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}
