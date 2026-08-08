import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface Finding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  dimension: string;
  evidence: string;
  fix: string;
}

interface DimensionResult {
  ok: boolean;
  findings: number;
  [key: string]: any;
}

export interface HealthCheckResult {
  score: number;
  verdict: 'healthy' | 'needs_revision' | 'blocked';
  context: 'greenfield' | 'migration' | 'doc-update';
  dimensions: Record<string, DimensionResult>;
  findings: Finding[];
  recommendations: string[];
  docHash: string;
  snapshotPath?: string;
  version: number;
}

@Injectable()
export class RequirementsDoctorService {
  private readonly logger = new Logger(RequirementsDoctorService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Runs the 8-dimension health check on requirements.md.
   * Returns score 0-100, verdict, findings, and persists a versioned snapshot.
   */
  async runHealthCheck(
    projectId: string,
    options: { strict?: boolean; migration?: boolean; noSave?: boolean } = {},
  ): Promise<HealthCheckResult> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const worktreePath = project.worktreeBase;
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      throw new NotFoundException('Worktree not found');
    }

    const requirementsPath = path.join(worktreePath, 'project_sdd', '01-context', 'requirements.md');
    if (!fs.existsSync(requirementsPath)) {
      throw new NotFoundException('requirements.md not found in project_sdd/01-context/');
    }

    const content = fs.readFileSync(requirementsPath, 'utf-8');
    const docHash = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;

    // Run all 8 dimensions
    const dimensions: Record<string, DimensionResult> = {};
    const findings: Finding[] = [];
    let penalty = 0;

    // Dimension 1: Front-matter
    const fm = this.checkFrontMatter(content);
    dimensions['front_matter'] = fm.result;
    findings.push(...fm.findings);
    penalty += fm.penalty;

    // Dimension 2: Visão do produto
    const visao = this.checkVisao(content);
    dimensions['visao'] = visao.result;
    findings.push(...visao.findings);
    penalty += visao.penalty;

    // Dimension 3: Epics / Features
    const epics = this.checkEpics(content);
    dimensions['epics'] = epics.result;
    findings.push(...epics.findings);
    penalty += epics.penalty;

    // Dimension 4: Histórias de usuário
    const histories = this.checkHistories(content);
    dimensions['histories'] = histories.result;
    findings.push(...histories.findings);
    penalty += histories.penalty;

    // Dimension 5: RF (Requisitos funcionais)
    const rf = this.checkRf(content);
    dimensions['rf'] = rf.result;
    findings.push(...rf.findings);
    penalty += rf.penalty;

    // Dimension 6: RNF (Requisitos não funcionais)
    const rnf = this.checkRnf(content);
    dimensions['rnf'] = rnf.result;
    findings.push(...rnf.findings);
    penalty += rnf.penalty;

    // Dimension 7: Lacunas etiquetadas
    const lacunas = this.checkLacunas(content);
    dimensions['lacunas'] = lacunas.result;
    findings.push(...lacunas.findings);
    penalty += lacunas.penalty;

    // Dimension 8: Coerência estrutural
    const coherence = this.checkCoherence(content);
    dimensions['coherence'] = coherence.result;
    findings.push(...coherence.findings);
    penalty += coherence.penalty;

    // Score
    const score = Math.max(0, 100 - penalty);

    // Auto-block checks
    const autoBlock = this.checkAutoBlock(dimensions, rf.result, histories.result, fm.findings, options.migration);

    // Determine verdict
    let verdict: 'healthy' | 'needs_revision' | 'blocked';
    if (autoBlock.blocked || score < (options.strict ? 80 : 50)) {
      verdict = 'blocked';
    } else if (score < 80) {
      verdict = 'needs_revision';
    } else {
      verdict = 'healthy';
    }

    // Migration override
    const context = options.migration ? 'migration' as const : 'greenfield' as const;
    if (options.migration && autoBlock.reason === 'zero_us_rf') {
      // Don't block on migration with zero US/RF
      if (score >= (options.strict ? 80 : 50)) {
        verdict = verdict === 'blocked' ? 'needs_revision' : verdict;
      }
    }

    // Recommendations
    const recommendations = this.buildRecommendations(findings);

    // Get next version number
    const lastCheck = await this.prisma.requirementsHealthCheck.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    const version = (lastCheck?.version || 0) + 1;

    // Persist unless --no-save
    let snapshotPath: string | undefined;
    if (!options.noSave) {
      snapshotPath = await this.persistSnapshot(projectId, project, version, {
        score, verdict, context, dimensions, findings, recommendations, docHash,
      });
    }

    this.logger.log(`Health check for ${projectId}: score=${score} verdict=${verdict} findings=${findings.length}`);

    return {
      score,
      verdict,
      context: context as any,
      dimensions,
      findings,
      recommendations,
      docHash,
      snapshotPath,
      version,
    };
  }

  /**
   * Gets the history of health checks for a project.
   */
  async getHealthHistory(projectId: string) {
    return this.prisma.requirementsHealthCheck.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      take: 50,
    });
  }

  /**
   * Gets a specific health check version.
   */
  async getHealthVersion(projectId: string, version: number) {
    return this.prisma.requirementsHealthCheck.findFirst({
      where: { projectId, version },
    });
  }

  // === Dimension implementations ===

  private checkFrontMatter(content: string): { result: DimensionResult; findings: Finding[]; penalty: number } {
    const findings: Finding[] = [];
    let penalty = 0;

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      findings.push({ id: 'FM-001', severity: 'critical', dimension: 'front_matter', evidence: 'line 1: no front-matter block', fix: 'add --- ... --- with title, source, extracted, hash, kpis' });
      return { result: { ok: false, findings: 1 }, findings, penalty: 50 };
    }

    const fm = fmMatch[1];
    const required = ['title', 'source', 'extracted', 'hash'];
    for (const field of required) {
      if (!new RegExp(`^${field}:`).test(fm)) {
        findings.push({ id: `FM-${field}`, severity: 'high', dimension: 'front_matter', evidence: `front-matter missing ${field}:`, fix: `add ${field}: <value> in front-matter` });
        penalty += 10;
      }
    }

    if (!/^kpis:/.test(fm)) {
      findings.push({ id: 'FM-kpis', severity: 'medium', dimension: 'front_matter', evidence: 'front-matter missing kpis:', fix: 'add kpis: { health: green }' });
      penalty += 5;
    }

    return { result: { ok: findings.length === 0, findings: findings.length }, findings, penalty };
  }

  private checkVisao(content: string): { result: DimensionResult; findings: Finding[]; penalty: number } {
    const findings: Finding[] = [];
    let penalty = 0;

    const visaoMatch = content.match(/^##\s+Vis(?:ã|a)o[^#]*?([\s\S]*?)(?=\n##\s|$)/im);
    if (!visaoMatch) {
      findings.push({ id: 'VIS-001', severity: 'medium', dimension: 'visao', evidence: 'no ## Visão section found', fix: 'add ## Visão do produto with 1 paragraph + 3-5 bullets' });
      return { result: { ok: false, findings: 1 }, findings, penalty: 15 };
    }

    const bullets = visaoMatch[1].match(/^- /gm) || [];
    if (bullets.length < 3) {
      findings.push({ id: 'VIS-002', severity: 'low', dimension: 'visao', evidence: `only ${bullets.length} bullets (expected 3-5)`, fix: 'add more descriptive bullets to Visão' });
      penalty += 8;
    }

    return { result: { ok: findings.length === 0, findings: findings.length }, findings, penalty };
  }

  private checkEpics(content: string): { result: DimensionResult; findings: Finding[]; penalty: number } {
    const findings: Finding[] = [];
    let penalty = 0;

    const epicMatches = content.match(/^\*\*EPIC-/gm) || [];
    if (epicMatches.length === 0) {
      findings.push({ id: 'EPI-001', severity: 'high', dimension: 'epics', evidence: 'no EPIC- entries found', fix: 'add **EPIC-01 — <name>** entries' });
      return { result: { ok: false, findings: 1, count: 0 }, findings, penalty: 20 };
    }

    return { result: { ok: true, findings: 0, count: epicMatches.length }, findings, penalty };
  }

  private checkHistories(content: string): { result: DimensionResult; findings: Finding[]; penalty: number } {
    const findings: Finding[] = [];
    let penalty = 0;

    const usMatches = content.match(/\*\*US-\d+/g) || [];
    const caMatches = content.match(/Crit(?:é|e)rios de aceite/gi) || [];

    if (usMatches.length === 0) {
      findings.push({ id: 'US-001', severity: 'high', dimension: 'histories', evidence: 'no US- entries found', fix: 'add **US-001 — <title>** with Como/Quero/Para + CA' });
      return { result: { ok: false, findings: 1, count: 0, without_ca: 0 }, findings, penalty: 20 };
    }

    const withoutCa = usMatches.length - caMatches.length;
    if (withoutCa > 0) {
      const capped = Math.min(withoutCa * 5, 25);
      findings.push({ id: 'US-002', severity: 'high', dimension: 'histories', evidence: `${withoutCa} US without CA (found ${caMatches.length} CA for ${usMatches.length} US)`, fix: 'add Critérios de aceite: section for each US' });
      penalty += capped;
    }

    return { result: { ok: withoutCa === 0, findings: findings.length, count: usMatches.length, without_ca: withoutCa }, findings, penalty };
  }

  private checkRf(content: string): { result: DimensionResult; findings: Finding[]; penalty: number } {
    const findings: Finding[] = [];
    let penalty = 0;

    const rfMatches = content.match(/^\| RF-\d+/gm) || [];
    if (rfMatches.length === 0) {
      findings.push({ id: 'RF-001', severity: 'high', dimension: 'rf', evidence: 'no RF- entries in table', fix: 'add | RF-01 | ... | prioridade | source | rows' });
      return { result: { ok: false, findings: 1, count: 0, without_priority: 0 }, findings, penalty: 20 };
    }

    // Check for blank priority cells (simple heuristic)
    const rfRows = content.match(/^\| RF-\d+\s*\|.*\|.*\|.*\|.*\|/gm) || [];
    let withoutPriority = 0;
    for (const row of rfRows) {
      const cells = row.split('|').map(c => c.trim());
      // Column 3 is priority (0-indexed: 0=empty, 1=id, 2=desc, 3=prio, 4=source)
      if (cells[3] === '' || cells[3] === '?') {
        withoutPriority++;
      }
    }
    if (withoutPriority > 0) {
      const capped = Math.min(withoutPriority * 3, 15);
      findings.push({ id: 'RF-002', severity: 'medium', dimension: 'rf', evidence: `${withoutPriority} RF without priority`, fix: 'add alta/media/baixa to each RF' });
      penalty += capped;
    }

    return { result: { ok: withoutPriority === 0, findings: findings.length, count: rfMatches.length, without_priority: withoutPriority }, findings, penalty };
  }

  private checkRnf(content: string): { result: DimensionResult; findings: Finding[]; penalty: number } {
    const findings: Finding[] = [];
    let penalty = 0;

    const rnfMatches = content.match(/^\| RNF-\d+/gm) || [];
    if (rnfMatches.length === 0) {
      findings.push({ id: 'RNF-001', severity: 'high', dimension: 'rnf', evidence: 'no RNF- entries in table', fix: 'add | RNF-01 | ... | categoria | metrica | source | rows' });
      return { result: { ok: false, findings: 1, count: 0, categories: 0 }, findings, penalty: 15 };
    }

    // Count distinct categories
    const rnfRows = content.match(/^\| RNF-\d+\s*\|.*\|.*\|.*\|.*\|/gm) || [];
    const categories = new Set<string>();
    for (const row of rnfRows) {
      const cells = row.split('|').map(c => c.trim());
      if (cells[3]) categories.add(cells[3].toLowerCase());
    }
    if (categories.size < 3) {
      findings.push({ id: 'RNF-002', severity: 'medium', dimension: 'rnf', evidence: `only ${categories.size} distinct categories (expected >=3)`, fix: 'add more RNF categories: performance, seguranca, availability, observabilidade' });
      penalty += 10;
    }

    return { result: { ok: findings.length === 0, findings: findings.length, count: rnfMatches.length, categories: categories.size }, findings, penalty };
  }

  private checkLacunas(content: string): { result: DimensionResult; findings: Finding[]; penalty: number } {
    const findings: Finding[] = [];
    let penalty = 0;

    // Count explicit labels
    const labeled = content.match(/\[(AMBIGUO|CONFLITO|AUSENTE|INFERIDO)\]/g) || [];
    
    // Search for hidden inferences
    const hiddenPatterns = /(?:assumindo|presumindo|provavelmente|talvez|acho\s*que|acredita)/gi;
    let hiddenCount = 0;
    let match: RegExpExecArray | null;
    while ((match = hiddenPatterns.exec(content)) !== null) {
      // Check nearby (±2 lines) for explicit label
      const startPos = Math.max(0, match.index - 200);
      const endPos = Math.min(content.length, match.index + 200);
      const context = content.slice(startPos, endPos);
      if (!/\[(AMBIGUO|CONFLITO|AUSENTE|INFERIDO)\]/.test(context)) {
        hiddenCount++;
      }
    }

    if (hiddenCount > 0) {
      const capped = Math.min(hiddenCount * 8, 25);
      findings.push({ id: 'LAC-001', severity: 'high', dimension: 'lacunas', evidence: `${hiddenCount} hidden inferences without [LABEL]`, fix: 'add [AMBIGUO] or [INFERIDO] near each assumption' });
      penalty += capped;
    }

    // Check for empty Lacunas section when inferences exist
    const lacunasMatch = content.match(/^##\s+Lacunas[^#]*?([\s\S]*?)(?=\n##\s|$)/im);
    if (lacunasMatch && labeled.length > 0) {
      const bullets = lacunasMatch[1].match(/^- /gm) || [];
      if (bullets.length < labeled.length) {
        findings.push({ id: 'LAC-002', severity: 'medium', dimension: 'lacunas', evidence: `Lacunas section has ${bullets.length} bullets but ${labeled.length} [LABEL]s found in body`, fix: 'list all [AMBIGO]/[CONFLITO]/[AUSENTE] in Lacunas section' });
        penalty += 10;
      }
    }

    return { result: { ok: findings.length === 0, findings: findings.length, ambiguous_unlabeled: hiddenCount, labeled: labeled.length }, findings, penalty };
  }

  private checkCoherence(content: string): { result: DimensionResult; findings: Finding[]; penalty: number } {
    const findings: Finding[] = [];
    let penalty = 0;

    const expected = [
      'Vis', 'Epic', 'Hist', 'Requisitos funcionais', 'Requisitos n', 'Restri', 'Premissas', 'Lacunas',
    ];
    let missing = 0;
    for (const section of expected) {
      if (!new RegExp(`^##\\s+${section}`, 'im').test(content)) {
        missing++;
        findings.push({ id: `COH-${section.slice(0, 3).toUpperCase()}`, severity: 'low', dimension: 'coherence', evidence: `section ## ${section}... not found`, fix: `add ## ${section}...` });
      }
    }
    penalty += missing * 5;

    return { result: { ok: findings.length === 0, findings: findings.length }, findings, penalty };
  }

  private checkAutoBlock(dimensions: any, rf: DimensionResult, histories: DimensionResult, fmFindings: Finding[], migration?: boolean): { blocked: boolean; reason?: string } {
    const zeroRf = (rf.count || 0) === 0;
    const zeroUs = (histories.count || 0) === 0;

    if (zeroRf && zeroUs && !migration) {
      return { blocked: true, reason: 'zero_us_rf' };
    }
    // Hash divergent = critical finding in front_matter
    const hashDivergent = fmFindings.some(f => f.id === 'FM-hash-divergent');
    if (hashDivergent) {
      return { blocked: true, reason: 'hash_divergent' };
    }
    return { blocked: false };
  }

  private buildRecommendations(findings: Finding[]): string[] {
    const recs: string[] = [];
    const highFindings = findings.filter(f => f.severity === 'high' || f.severity === 'critical');
    const mediumFindings = findings.filter(f => f.severity === 'medium');

    for (const f of highFindings.slice(0, 5)) {
      if (f.dimension === 'histories' && f.id === 'US-002') {
        recs.push('ENTREVISTAR stakeholder sobre Critérios de Aceite ausentes');
      } else if (f.dimension === 'rf') {
        recs.push('Atribuir prioridade (alta/media/baixa) em RFs sem prioridade');
      } else if (f.dimension === 'epics') {
        recs.push('Estruturar Epics/Features no documento de requisitos');
      } else if (f.dimension === 'rnf') {
        recs.push('Adicionar RNFs cobrindo performance, seguranca e availability');
      }
    }

    for (const f of mediumFindings.slice(0, 3)) {
      if (f.dimension === 'rnf' && f.id === 'RNF-002') {
        recs.push('Ampliar categorias de RNF para cobrir >=3 tipos');
      } else if (f.dimension === 'lacunas') {
        recs.push('Listar todas as lacunas etiquetadas na seção Lacunas encontradas');
      }
    }

    if (recs.length === 0) {
      recs.push('Documento saudável. Pronto para gerar plano SDD.');
    }

    return recs;
  }

  private async persistSnapshot(
    projectId: string,
    project: any,
    version: number,
    result: { score: number; verdict: string; context: string; dimensions: any; findings: Finding[]; recommendations: string[]; docHash: string },
  ): Promise<string> {
    const worktreePath = project.worktreeBase;
    const healthDir = path.join(worktreePath, 'project_sdd', '01-context', 'requirements-health');
    fs.mkdirSync(healthDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `v${String(version).padStart(3, '0')}-${timestamp}.md`;
    const snapshotPath = path.join(healthDir, filename);

    // Write snapshot file
    const lines: string[] = [
      '---',
      `version: v${String(version).padStart(3, '0')}`,
      `checked_at: ${new Date().toISOString()}`,
      `source: ${project.name}`,
      `doc_hash: ${result.docHash}`,
      `score: ${result.score}`,
      `verdict: ${result.verdict}`,
      `context: ${result.context}`,
      `---`,
      '',
      `# Health check v${String(version).padStart(3, '0')} — ${new Date().toLocaleString()}`,
      '',
      `## Summary`,
      '',
      `Score: ${result.score}/100 | Verdict: ${result.verdict}`,
      `Findings: ${result.findings.length}`,
      '',
      '## Findings',
      '',
    ];

    // Group by severity
    for (const sev of ['critical', 'high', 'medium', 'low']) {
      const grouped = result.findings.filter(f => f.severity === sev);
      if (grouped.length > 0) {
        lines.push(`### ${sev.toUpperCase()}`);
        for (const f of grouped) {
          lines.push(`- **${f.id}** ${f.evidence}`, `  - Fix: ${f.fix}`);
        }
        lines.push('');
      }
    }

    lines.push('## Recommendations', '');
    for (const r of result.recommendations) {
      lines.push(`${r}.`);
    }

    fs.writeFileSync(snapshotPath, lines.join('\n'), 'utf-8');

    // Persist to database
    await this.prisma.requirementsHealthCheck.create({
      data: {
        projectId,
        version,
        score: result.score,
        verdict: result.verdict,
        context: result.context,
        dimensions: result.dimensions as any,
        findings: result.findings as any,
        recommendations: result.recommendations as any,
        docHash: result.docHash,
      },
    });

    // Update INDEX.md in requirements-health
    await this.updateHealthIndex(healthDir, projectId);

    // Update kpis in requirements.md front-matter
    await this.updateKpisInRequirements(worktreePath, result.score, result.verdict);

    return snapshotPath;
  }

  private async updateHealthIndex(healthDir: string, projectId: string) {
    const indexPath = path.join(healthDir, 'INDEX.md');
    const checks = await this.prisma.requirementsHealthCheck.findMany({
      where: { projectId },
      orderBy: { version: 'asc' },
    });

    const lines = [
      '# Health check history', '',
      '| Version | Checked_at | Score | Verdict |',
      '|---|---|---|---|',
    ];
    for (const c of checks) {
      lines.push(`| v${String(c.version).padStart(3, '0')} | ${c.checkedAt.toISOString()} | ${c.score} | ${c.verdict} |`);
    }
    fs.writeFileSync(indexPath, lines.join('\n'), 'utf-8');
  }

  private async updateKpisInRequirements(worktreePath: string, score: number, verdict: string) {
    const reqPath = path.join(worktreePath, 'project_sdd', '01-context', 'requirements.md');
    if (!fs.existsSync(reqPath)) return;
    let content = fs.readFileSync(reqPath, 'utf-8');
    const health = verdict === 'healthy' ? 'green' : verdict === 'needs_revision' ? 'yellow' : 'red';
    content = content.replace(/kpis:\s*\{[^}]*\}/, `kpis: { health: ${health}, last_score: ${score} }`);
    fs.writeFileSync(reqPath, content, 'utf-8');
  }
}