import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';

@Injectable()
export class RequirementsExtractService {
  private readonly logger = new Logger(RequirementsExtractService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Extracts text from .docx/.pdf/.md/.txt via ia-framework extract scripts.
   * Returns the raw text content.
   */
  async extractText(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`File not found: ${filePath}`);
    }

    if (ext === '.md' || ext === '.txt') {
      return fs.readFileSync(filePath, 'utf-8');
    }

    if (ext === '.docx') {
      return this.extractDocx(filePath);
    }

    if (ext === '.pdf') {
      return this.extractPdf(filePath);
    }

    throw new BadRequestException(`Unsupported file extension: ${ext}`);
  }

  /**
   * Extracts text from .docx via ia-framework extract.ps1/extract.sh.
   */
  private async extractDocx(filePath: string): Promise<string> {
    const scriptPath = this.getExtractScriptPath();
    return this.runExtractScript(scriptPath, filePath);
  }

  /**
   * Extracts text from .pdf via pdftotext (through extract script).
   */
  private async extractPdf(filePath: string): Promise<string> {
    const scriptPath = this.getExtractScriptPath();
    return this.runExtractScript(scriptPath, filePath);
  }

  private getExtractScriptPath(): string {
    const iaFrameworkPath = process.env.IA_FRAMEWORK_PATH || '../ia-framework';
    const basePath = path.resolve(iaFrameworkPath);
    const psScript = path.join(basePath, 'skills', 'requirements', 'extract.ps1');
    const shScript = path.join(basePath, 'skills', 'requirements', 'extract.sh');
    
    if (process.platform === 'win32' && fs.existsSync(psScript)) {
      return psScript;
    }
    if (fs.existsSync(shScript)) {
      return shScript;
    }
    throw new Error('Extract script not found. Ensure ia-framework is in the project.');
  }

  private async runExtractScript(scriptPath: string, filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const isPs = scriptPath.endsWith('.ps1');
      const cmd = isPs ? 'powershell' : 'bash';
      const args = isPs
        ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, filePath]
        : [scriptPath, filePath];

      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code: number) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Extract failed (exit ${code}): ${stderr}`));
        }
      });
      child.on('error', reject);
    });
  }

  /**
   * Computes SHA-256 hash of a file.
   */
  computeHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
  }

  /**
   * Normalizes extracted text into requirements.md template format.
   * This is a simplified version — the full LLM-powered normalization
   * happens in the CLI session via the requirements-reader agent.
   * Here we just persist the raw extracted text in the template envelope.
   */
  async normalizeAndPersist(projectId: string, sourcePath: string, extractedText: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const worktreePath = project.worktreeBase;
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      throw new BadRequestException(`Worktree not found for project ${projectId}`);
    }

    const hash = this.computeHash(sourcePath);
    const now = new Date().toISOString().split('T')[0];
    const sourceName = path.basename(sourcePath);
    const requirementsDir = path.join(worktreePath, 'project_sdd', '01-context');
    const requirementsPath = path.join(requirementsDir, 'requirements.md');

    // Ensure directory exists
    fs.mkdirSync(requirementsDir, { recursive: true });

    // Build front-matter + raw extracted text as placeholder
    // The full normalization (Epics, US, RF, RNF, etc.) is done by the
    // requirements-reader agent in a CLI session — here we persist a
    // structured placeholder that the doctor can still evaluate.
    const content = [
      '---',
      `title: Requisitos extraidos`,
      `source: ${path.relative(worktreePath, sourcePath)}`,
      `extracted: ${now}`,
      `hash: ${hash}`,
      `kpis: { health: yellow }`,
      '---',
      '',
      '# Requisitos extraidos',
      '',
      '> Extraido automaticamente pelo extract script. Normalizacao completa',
      '> via requirements-reader agent em sessao CLI pendente.',
      '',
      extractedText,
      '',
    ].join('\n');

    fs.writeFileSync(requirementsPath, content, 'utf-8');
    this.logger.log(`requirements.md persisted at ${requirementsPath} (${content.length} chars)`);

    return requirementsPath;
  }
}