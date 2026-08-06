/**
 * Consome o report de fim de macro task (contratos §6) e transforma cada
 * `finding` numa macro task de backlog (melhorias.md #5).
 *
 * Por que assinar Redis em vez de chamar isto do `completeSession`: o
 * `pipeline-engine.service.ts` é o arquivo mais disputado da iniciativa e ele já
 * publica `SESSION_COMPLETED`. Assinar o canal entrega o mesmo comportamento com
 * zero linha de diff lá — e mantém a ingestão FORA do caminho crítico, então um
 * erro aqui não atrasa o cleanup nem o merge da sessão.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CHANNELS } from '../redis/channels';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { parseTaskReport, type TaskReportFinding } from './task-report.contract';
import { pipelineNameForEffort, scoreFinding, scoreWithRepeats } from './backlog-scoring';
import { findDuplicate } from './backlog-dedupe';

/** Status novo. `MacroTask.status` é String livre — sem migration. */
export const BACKLOG_STATUS = 'backlog';

/** Onde o finding foi visto. Repetição vira contagem, não item duplicado. */
export interface BacklogSeenIn {
  macroTaskId: string;
  sessionId: string;
  artifactId?: string;
  at: string;
}

/** Bloco gravado em `MacroTask.metadata` dos itens de backlog. */
export interface BacklogMetadata {
  kind: string;
  effort: string;
  /** Escala fina que ordena a tabela (a coluna `priority` guarda só o bucket). */
  score: number;
  files: string[];
  detail?: string;
  /** Prova que o finding trouxe (arquivo:linha, comando rodado). Pode não existir. */
  evidence?: string[];
  seenIn: BacklogSeenIn[];
  /** Preenchido só quando o report chegou torto — sinaliza revisão humana. */
  parseErrors?: string[];
}

/** Caminho do artefato de diagnóstico ao lado do report. Citado como evidência. */
function parseErrorPath(reportPath: string): string {
  return `${reportPath.replace(/\.json$/, '')}.parse-error.json`;
}

/** `true` para objeto simples — exclui `null`, array e escalar. */
function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Lê `MacroTask.metadata` sem confiar nele. É Json livre: item criado à mão pela
 * UI, importado de JSON colado ou gravado por uma versão anterior deste código
 * pode não ter `backlog`, ou ter ali algo que não é objeto. Devolve `{}` em vez de
 * mentir no tipo — quem chama aplica os próprios defaults.
 */
export function readBacklogMetadata(metadata: unknown): Partial<BacklogMetadata> {
  if (!isPlainObject(metadata)) return {};
  return isPlainObject(metadata.backlog) ? (metadata.backlog as Partial<BacklogMetadata>) : {};
}

/** `metadata` inteiro como objeto seguro para spread. */
export function readMacroTaskMetadata(metadata: unknown): Record<string, any> {
  return isPlainObject(metadata) ? metadata : {};
}

export interface BacklogIngestResult {
  sessionId: string;
  created: number;
  merged: number;
  skipped: number;
  errors: string[];
}

interface ExistingBacklogItem {
  id: string;
  title: string;
  files: string[];
  /** `Partial` de propósito: vem de Json livre, campo pode faltar. */
  metadata: Partial<BacklogMetadata>;
}

@Injectable()
export class BacklogIngestService implements OnModuleInit {
  private readonly logger = new Logger(BacklogIngestService.name);

  /**
   * Fila de largura 1. O dedupe decide comparando contra o que JÁ está no banco,
   * então duas ingestões concorrentes leem o mesmo estado e cada uma cria o item
   * que a outra também vai criar. Não é hipotético: uma onda tem 4–5 sessões
   * paralelas que terminam por volta do mesmo minuto, que é exatamente o cenário
   * em que o dedupe precisa funcionar.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private artifacts: ArtifactsService,
  ) {}

  /** Serializa `task` atrás das ingestões já enfileiradas, sem herdar rejeição. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async onModuleInit() {
    await this.redis.subscribe(CHANNELS.SESSION_COMPLETED, (event: any) => {
      const sessionId = event?.sessionId;
      if (typeof sessionId !== 'string' || !sessionId) return;
      // Não dá await: o publisher (`completeSession`) não deve esperar a
      // ingestão, e uma falha aqui não pode escapar para o caminho dele.
      void this.ingestSession(sessionId).catch((error) =>
        this.logger.warn(`Backlog ingest falhou para a sessão ${sessionId}: ${error.message}`),
      );
    });
  }

  /**
   * Lê o report da sessão e materializa o backlog. Idempotente: rodar duas vezes
   * na mesma sessão não duplica, porque o dedupe casa contra os itens que a
   * própria sessão já criou (ver `skipped`).
   */
  async ingestSession(sessionId: string): Promise<BacklogIngestResult> {
    return this.enqueue(() => this.ingestSessionSerialized(sessionId));
  }

  private async ingestSessionSerialized(sessionId: string): Promise<BacklogIngestResult> {
    const result: BacklogIngestResult = { sessionId, created: 0, merged: 0, skipped: 0, errors: [] };

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        macroTask: { select: { id: true, projectId: true, pipelineId: true, title: true } },
      },
    });
    if (!session?.macroTask) {
      result.errors.push('Sessão ou macro task de origem não encontrada.');
      return result;
    }
    const origin = session.macroTask;

    const artifact = await this.artifacts.findTaskReport(sessionId);
    if (!artifact) {
      // Nem todo pipeline tem stage de Report — ausência não é erro.
      this.logger.debug(`Sessão ${sessionId} sem task-report; nada a ingerir.`);
      return result;
    }

    const parsed = parseTaskReport(artifact.content);
    result.errors = parsed.errors;

    // Report vazio é RESULTADO VÁLIDO, não falha de parse: a sessão olhou e não
    // achou nada que valesse uma task. Decidir por `findings.length === 0` (como
    // era até a MT-24) fazia esse caso gerar `.parse-error.json` e um item
    // `[report não parseável]` que um humano fechava à mão — e que estragava a
    // métrica de qualidade dos reports. Quem decide agora é `parsed.outcome`.
    if (parsed.outcome === 'empty') {
      // Desvio de forma sem perda de conteúdo (report sem a chave `findings`) some
      // do caminho automático se não for logado aqui — o log do fim não roda.
      if (result.errors.length > 0) {
        this.logger.warn(
          `Report da sessão ${sessionId} sem findings, com desvio de forma: ${result.errors.join(' | ')}`,
        );
      } else {
        this.logger.log(`Sessão ${sessionId}: report sem findings — nada a ingerir.`);
      }
      return result;
    }

    let findings = parsed.findings;
    if (parsed.outcome === 'unparseable') {
      // Perder a informação em silêncio é o pior desfecho: sobra pelo menos um
      // item apontando para o artefato cru, para um humano olhar.
      await this.saveParseFailureArtifact(sessionId, artifact.path, artifact.content, parsed.errors);
      findings = [this.unparseableFinding(origin.title, artifact.path, parsed.errors)];
    }

    const existing = await this.loadExistingBacklog(origin.projectId);
    const pipelineIds = await this.resolvePipelineIds(origin.projectId);

    for (const finding of findings) {
      try {
        const duplicate = findDuplicate(finding, existing);
        if (duplicate) {
          const seen = duplicate.metadata?.seenIn ?? [];
          // Mesma sessão = reprocessamento do mesmo report, não consenso novo.
          if (seen.some((entry) => entry.sessionId === sessionId)) {
            result.skipped += 1;
            continue;
          }
          await this.mergeIntoExisting(duplicate, finding, origin, sessionId, artifact.id);
          result.merged += 1;
          continue;
        }

        const created = await this.createBacklogItem(finding, origin, sessionId, artifact.id, pipelineIds);
        // Entra na lista em memória para deduplicar contra os irmãos do mesmo report.
        existing.push(created);
        result.created += 1;
      } catch (error) {
        result.errors.push(`"${finding.title}": ${error.message}`);
        this.logger.warn(`Falha ao materializar finding "${finding.title}": ${error.message}`);
      }
    }

    this.logger.log(
      `Backlog da sessão ${sessionId}: ${result.created} criados, ${result.merged} fundidos, ${result.skipped} já existentes.`,
    );
    // Degradação PARCIAL (report abriu, mas algum finding foi descartado ou
    // corrigido) não gera item nem artefato de erro — sem este log ela não
    // apareceria em lugar nenhum no caminho automático.
    if (result.errors.length > 0) {
      this.logger.warn(
        `Report da sessão ${sessionId} com ${result.errors.length} problema(s): ${result.errors.join(' | ')}`,
      );
    }
    return result;
  }

  /**
   * Backfill: varre as sessões concluídas do projeto e ingere os reports que
   * ninguém consumiu. Acionado à mão (endpoint), nunca no boot — criar dezenas
   * de itens sem o usuário pedir é como o backlog vira cemitério.
   */
  async ingestProject(projectId: string): Promise<BacklogIngestResult[]> {
    const sessions = await this.prisma.session.findMany({
      where: { macroTask: { projectId } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const results: BacklogIngestResult[] = [];
    for (const session of sessions) {
      // Sequencial de propósito: o dedupe lê o estado do banco a cada sessão e
      // em paralelo duas sessões criariam o mesmo item sem se ver.
      results.push(await this.ingestSession(session.id));
    }
    return results;
  }

  // --------------------------------------------------------------- internos

  private unparseableFinding(
    originTitle: string,
    artifactPath: string,
    errors: string[],
  ): TaskReportFinding {
    return {
      kind: 'debt',
      title: `[report não parseável] ${originTitle}`,
      detail: `O report de fim de task não pôde ser lido: ${errors.join(' ')} Revise o artefato bruto da sessão.`,
      files: [],
      effort: 's',
      // Este é o único finding gerado por código, então a evidência é exata: o
      // artefato cru e o diagnóstico gravado ao lado dele.
      evidence: [artifactPath, parseErrorPath(artifactPath)],
      priority: 0,
    };
  }

  /**
   * Grava o texto cru + o diagnóstico como artefato próprio. O conteúdo original
   * já está no banco, mas separado dos erros — juntar os dois é o que torna a
   * inspeção humana viável sem ler código.
   */
  private async saveParseFailureArtifact(
    sessionId: string,
    path: string,
    raw: string | null,
    errors: string[],
  ): Promise<void> {
    const errorPath = parseErrorPath(path);
    try {
      // A ingestão pode rodar de novo (evento reentregue, backfill manual) e o
      // diagnóstico é o mesmo — sobrescreve em vez de empilhar cópias.
      const previous = await this.prisma.sDDArtifact.findFirst({
        where: { sessionId, path: errorPath },
        select: { id: true },
      });
      const content = JSON.stringify({ errors, raw }, null, 2);
      if (previous) {
        await this.prisma.sDDArtifact.update({ where: { id: previous.id }, data: { content } });
        return;
      }
      await this.prisma.sDDArtifact.create({
        data: { sessionId, type: 'other', path: errorPath, content },
      });
    } catch (error) {
      // Falhar aqui não pode impedir a criação do item de backlog.
      this.logger.warn(`Não gravou o artefato de erro de parse (${sessionId}): ${error.message}`);
    }
  }

  private async loadExistingBacklog(projectId: string): Promise<ExistingBacklogItem[]> {
    const items = await this.prisma.macroTask.findMany({
      where: { projectId, status: BACKLOG_STATUS },
      select: { id: true, title: true, metadata: true },
    });
    return items.map((item) => {
      const backlog = readBacklogMetadata(item.metadata);
      return {
        id: item.id,
        title: item.title,
        files: Array.isArray(backlog.files) ? backlog.files : [],
        metadata: backlog,
      };
    });
  }

  /**
   * Mapa nome→id dos pipelines do projeto. Os nomes de `PIPELINE_BY_EFFORT` só
   * existem em projetos que os criaram, então o id pode não vir — quem chama cai
   * no pipeline da task de origem (`MacroTask.pipelineId` é NOT NULL).
   */
  private async resolvePipelineIds(projectId: string): Promise<Map<string, string>> {
    const pipelines = await this.prisma.pipeline.findMany({
      where: { projectId },
      select: { id: true, name: true },
    });
    return new Map(pipelines.map((pipeline) => [pipeline.name, pipeline.id]));
  }

  private async createBacklogItem(
    finding: TaskReportFinding,
    origin: { id: string; projectId: string; pipelineId: string; title: string },
    sessionId: string,
    artifactId: string,
    pipelineIds: Map<string, string>,
  ): Promise<ExistingBacklogItem> {
    const { score, priority } = scoreFinding(finding);
    const suggestedPipeline = pipelineNameForEffort(finding.effort);
    const pipelineId = pipelineIds.get(suggestedPipeline) ?? origin.pipelineId;

    const backlog: BacklogMetadata = {
      kind: finding.kind,
      effort: finding.effort,
      score,
      files: finding.files,
      detail: finding.detail,
      evidence: finding.evidence,
      seenIn: [{ macroTaskId: origin.id, sessionId, artifactId, at: new Date().toISOString() }],
    };

    const created = await this.prisma.macroTask.create({
      data: {
        projectId: origin.projectId,
        pipelineId,
        title: finding.title,
        description: this.buildDescription(finding, origin.title),
        status: BACKLOG_STATUS,
        priority,
        metadata: {
          origin: { macroTaskId: origin.id, sessionId, kind: finding.kind, artifactId },
          backlog: backlog as any,
          /** Guardado à parte: o id pode ter caído no fallback. */
          suggestedPipeline,
        },
      },
      select: { id: true, title: true },
    });
    return { id: created.id, title: created.title, files: finding.files, metadata: backlog };
  }

  /**
   * A descrição gerada aqui é o que a PRÓXIMA sessão lê como se fosse fato. Já
   * aconteceu de 4 afirmações de uma descrição assim caírem quando a sessão foi
   * conferir (`00-PLANO.md §9` que não existia, "7 arquivos" que eram 5), porque o
   * texto do finding chegava sem prova e ninguém revalidava. Daí o bloco de
   * evidência com o aviso explícito: o consumidor tem o que reconferir e sabe que
   * precisa reconferir. Sem evidência, a ausência é dita em voz alta em vez de o
   * texto passar por verificado.
   */
  private buildDescription(finding: TaskReportFinding, originTitle: string): string {
    const lines = [finding.detail ?? finding.title, ''];
    if (finding.files.length > 0) lines.push(`Arquivos: ${finding.files.join(', ')}`);
    lines.push('', 'Evidência (NÃO verificada — reconfira antes de agir):');
    if (finding.evidence?.length) {
      for (const item of finding.evidence) lines.push(`- ${item}`);
    } else {
      lines.push('- (nenhuma) O report não trouxe prova. Confirme que o problema existe hoje');
      lines.push('  antes de mudar qualquer coisa; se não existir, feche esta task como obsoleta.');
    }
    lines.push('', `Origem: ${originTitle} (${finding.kind}, esforço ${finding.effort})`);
    return lines.join('\n');
  }

  /**
   * Segunda sessão viu a mesma coisa: soma a origem em `seenIn` e sobe o score.
   * O texto do item não é reescrito — o primeiro título já foi lido por um
   * humano e trocá-lo por baixo mudaria o item que ele estava acompanhando.
   */
  private async mergeIntoExisting(
    existing: ExistingBacklogItem,
    finding: TaskReportFinding,
    origin: { id: string; projectId: string; pipelineId: string; title: string },
    sessionId: string,
    artifactId: string,
  ): Promise<void> {
    const current = await this.prisma.macroTask.findUnique({
      where: { id: existing.id },
      select: { metadata: true },
    });
    const metadata = readMacroTaskMetadata(current?.metadata);
    const backlog = readBacklogMetadata(current?.metadata);

    const seenIn: BacklogSeenIn[] = Array.isArray(backlog.seenIn) ? [...backlog.seenIn] : [];
    seenIn.push({ macroTaskId: origin.id, sessionId, artifactId, at: new Date().toISOString() });

    const files = Array.isArray(backlog.files) ? [...backlog.files] : [];
    for (const file of finding.files) if (!files.includes(file)) files.push(file);

    // Evidência ACUMULA como `files`: a segunda sessão que viu a mesma coisa
    // normalmente aponta para outro lugar, e as duas provas juntas valem mais que
    // a primeira. Fica `undefined` quando ninguém trouxe prova — o item continua
    // dizendo que não há o que reconferir em vez de exibir uma lista vazia.
    const evidence = Array.isArray(backlog.evidence) ? [...backlog.evidence] : [];
    for (const item of finding.evidence ?? []) if (!evidence.includes(item)) evidence.push(item);

    // O score base é o do finding mais forte visto até agora, não o da primeira
    // sessão: um bug reportado depois como "s" deve puxar o item para cima.
    // `score` gravado pode ser string num item que não passou por aqui.
    const storedScore = typeof backlog.score === 'number' ? backlog.score : 0;
    const baseScore = Math.max(scoreFinding(finding).score, storedScore);
    const { score, priority } = scoreWithRepeats(baseScore, seenIn.length);

    const merged: BacklogMetadata = {
      // `kind`/`effort` só entram se faltarem: o item original manda, mas um item
      // sem eles (criado antes, ou à mão) fica preenchido em vez de vazio na UI.
      kind: backlog.kind ?? finding.kind,
      effort: backlog.effort ?? finding.effort,
      detail: backlog.detail ?? finding.detail,
      parseErrors: backlog.parseErrors,
      evidence: evidence.length > 0 ? evidence : undefined,
      files,
      score,
      seenIn,
    };

    await this.prisma.macroTask.update({
      where: { id: existing.id },
      data: { priority, metadata: { ...metadata, backlog: merged as any } },
    });
    existing.metadata = merged;
    existing.files = files;
  }
}
