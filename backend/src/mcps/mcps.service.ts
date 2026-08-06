import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMcpDto } from './dto/create-mcp.dto';
import { UpdateMcpDto } from './dto/update-mcp.dto';
import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import * as path from 'path';

export interface McpTestResult {
  reachable: boolean;
  mode: 'http' | 'sse' | 'stdio';
  latencyMs?: number;
  serverInfo?: { name?: string; version?: string };
  resolvedPath?: string;
  error?: string;
}

@Injectable()
export class McpsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateMcpDto, projectId?: string) {
    const mcp = await this.prisma.mCP.create({ data: dto });
    if (projectId) {
      await this.prisma.projectMCP.create({
        data: { projectId, mcpId: mcp.id },
      });
    }
    return mcp;
  }

  async findAll() {
    return this.prisma.mCP.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const mcp = await this.prisma.mCP.findUnique({ where: { id } });
    if (!mcp) throw new NotFoundException('MCP not found');
    return mcp;
  }

  async update(id: string, dto: UpdateMcpDto) {
    await this.findOne(id);
    return this.prisma.mCP.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.mCP.delete({ where: { id } });
  }

  async connect(id: string) {
    await this.findOne(id);
    return this.prisma.mCP.update({
      where: { id },
      data: { connected: true },
    });
  }

  async disconnect(id: string) {
    await this.findOne(id);
    return this.prisma.mCP.update({
      where: { id },
      data: { connected: false },
    });
  }

  async test(id: string): Promise<McpTestResult> {
    const mcp = await this.findOne(id);
    const endpoint = (mcp.endpoint || '').trim();

    let result: McpTestResult;
    if (!endpoint) {
      result = {
        reachable: false,
        mode: 'stdio',
        error: 'MCP has no endpoint or command configured',
      };
    } else if (/^https?:\/\//i.test(endpoint)) {
      result = await this.testHttpEndpoint(endpoint);
    } else {
      result = await this.testStdioCommand(endpoint);
    }

    await this.prisma.mCP.update({
      where: { id },
      data: { connected: result.reachable },
    });

    return result;
  }

  private async testHttpEndpoint(endpoint: string): Promise<McpTestResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const start = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'orchestrator-test', version: '1.0' },
          },
        }),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - start;
      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        // SSE stream opened: the server is reachable; don't parse the stream.
        controller.abort();
        return { reachable: true, mode: 'sse', latencyMs };
      }

      if (res.ok) {
        try {
          const body: any = await res.json();
          const serverInfo = body?.result?.serverInfo;
          if (serverInfo) {
            return {
              reachable: true,
              mode: 'http',
              latencyMs,
              serverInfo: { name: serverInfo.name, version: serverInfo.version },
            };
          }
          if (body?.jsonrpc === '2.0') {
            return { reachable: true, mode: 'http', latencyMs };
          }
          return {
            reachable: false,
            mode: 'http',
            latencyMs,
            error: `HTTP ${res.status} but response is not valid JSON-RPC`,
          };
        } catch {
          return {
            reachable: false,
            mode: 'http',
            latencyMs,
            error: `HTTP ${res.status} but response body is not JSON`,
          };
        }
      }

      return { reachable: false, mode: 'http', latencyMs, error: `HTTP ${res.status}` };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const message =
        err?.name === 'AbortError'
          ? 'Timeout after 5000ms'
          : err?.cause?.message || err?.message || 'Connection failed';
      return { reachable: false, mode: 'http', latencyMs, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  private async testStdioCommand(command: string): Promise<McpTestResult> {
    const binary = command.split(/\s+/)[0];

    if (binary.includes('/')) {
      const resolvedPath = path.resolve(binary);
      try {
        await fs.access(resolvedPath, fsConstants.X_OK);
        return { reachable: true, mode: 'stdio', resolvedPath };
      } catch {
        return {
          reachable: false,
          mode: 'stdio',
          error: `"${binary}" does not exist or is not executable`,
        };
      }
    }

    const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
      const candidate = path.join(dir, binary);
      try {
        await fs.access(candidate, fsConstants.X_OK);
        return { reachable: true, mode: 'stdio', resolvedPath: candidate };
      } catch {}
    }

    return {
      reachable: false,
      mode: 'stdio',
      error: `Binary "${binary}" not found in PATH`,
    };
  }

  async scan(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { mainPath: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const results: Array<{ name: string; endpoint: string; type: string; source: string; file?: string }> = [];
    // .mcp.json é o arquivo padrão do Claude Code e tinha ficado fora da lista
    const configFiles = ['.mcp.json', '.opencode.json', '.claude/settings.json', 'mcp.json', '.opencode/mcp.json'];
    const seen = new Set<string>();

    for (const configFile of configFiles) {
      const fullPath = path.join(project.mainPath, configFile);
      try {
        const resolvedPath = path.resolve(fullPath);
        if (!resolvedPath.startsWith(path.resolve(project.mainPath))) continue;
        const content = await fs.readFile(resolvedPath, 'utf-8');
        const config = JSON.parse(content);
        // aceita tanto a chave "mcpServers" (Claude Code) quanto "mcp" (variantes)
        const servers = { ...(config.mcp || {}), ...(config.mcpServers || {}) };
        if (servers && typeof servers === 'object') {
          for (const [name, serverConfig] of Object.entries(servers)) {
            if (seen.has(name)) continue;
            seen.add(name);
            const server = serverConfig as any;
            const command = [server.command, ...(Array.isArray(server.args) ? server.args : [])]
              .filter(Boolean)
              .join(' ');
            results.push({
              name,
              endpoint: server.url || command || 'unknown',
              type: server.url ? (server.type === 'sse' ? 'sse' : 'http') : 'stdio',
              source: 'scan',
              file: configFile,
            });
          }
        }
      } catch {}
    }

    return results;
  }

  async scanGlobal() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/home/monke';
    const defaultsPath = path.join(homeDir, '.orchestr', 'defaults', 'mcps');
    const results: Array<{ name: string; endpoint: string; type: string; source: string; global: boolean }> = [];

    try {
      const files = await fs.readdir(defaultsPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readFile(path.join(defaultsPath, file), 'utf-8');
            const config = JSON.parse(content);
            if (config.mcpServers && typeof config.mcpServers === 'object') {
              for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
                const server = serverConfig as any;
                results.push({
                  name,
                  endpoint: server.url || server.command || 'unknown',
                  type: server.url ? 'http' : 'stdio',
                  source: 'scan',
                  global: true,
                });
              }
            }
          } catch {}
        }
      }
    } catch {}

    return results;
  }

  /**
   * Monta a entrada de mcpServers no formato do .mcp.json a partir do registro:
   * endpoint http(s) → { type: http|sse, url }; senão → { command, args }.
   */
  private buildServerConfig(mcp: { endpoint: string | null; metadata: any }) {
    const endpoint = (mcp.endpoint || '').trim();
    if (!endpoint) {
      throw new BadRequestException('MCP has no endpoint/command — set one before injecting');
    }
    if (/^https?:\/\//i.test(endpoint)) {
      const type = mcp.metadata?.type === 'sse' ? 'sse' : 'http';
      return { type, url: endpoint };
    }
    const parts = endpoint.split(/\s+/);
    return { command: parts[0], args: parts.slice(1) };
  }

  private async resolveProjectMainPath(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { mainPath: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    const exists = await fs
      .stat(project.mainPath)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!exists) {
      throw new BadRequestException(`Project mainPath does not exist: ${project.mainPath}`);
    }
    return project.mainPath;
  }

  private async readMcpJson(mainPath: string): Promise<Record<string, any>> {
    const raw = await fs.readFile(path.join(mainPath, '.mcp.json'), 'utf-8').catch(() => null);
    if (raw === null) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new BadRequestException('.mcp.json of the project contains invalid JSON — fix it first');
    }
  }

  /** Injeta de verdade: grava a entrada em <mainPath>/.mcp.json + registra a pivot. */
  async injectIntoProject(mcpId: string, projectId: string) {
    const mcp = await this.prisma.mCP.findUnique({ where: { id: mcpId } });
    if (!mcp) throw new NotFoundException('MCP not found');
    const mainPath = await this.resolveProjectMainPath(projectId);

    const config = await this.readMcpJson(mainPath);
    if (!config.mcpServers || typeof config.mcpServers !== 'object') config.mcpServers = {};
    config.mcpServers[mcp.name] = this.buildServerConfig(mcp as any);
    await fs.writeFile(
      path.join(mainPath, '.mcp.json'),
      JSON.stringify(config, null, 2) + '\n',
      'utf-8',
    );

    await this.prisma.projectMCP.upsert({
      where: { projectId_mcpId: { projectId, mcpId } },
      create: { projectId, mcpId },
      update: {},
    });
    return { injected: true, file: '.mcp.json', server: mcp.name };
  }

  /** Remove a entrada do .mcp.json (se existir) + apaga a pivot. */
  async removeFromProject(mcpId: string, projectId: string) {
    const mcp = await this.prisma.mCP.findUnique({ where: { id: mcpId } });
    if (!mcp) throw new NotFoundException('MCP not found');
    const mainPath = await this.resolveProjectMainPath(projectId);

    const config = await this.readMcpJson(mainPath);
    if (config.mcpServers && typeof config.mcpServers === 'object' && mcp.name in config.mcpServers) {
      delete config.mcpServers[mcp.name];
      await fs.writeFile(
        path.join(mainPath, '.mcp.json'),
        JSON.stringify(config, null, 2) + '\n',
        'utf-8',
      );
    }

    await this.prisma.projectMCP
      .delete({ where: { projectId_mcpId: { projectId, mcpId } } })
      .catch(() => undefined);
    return { removed: true, file: '.mcp.json', server: mcp.name };
  }

  async getProjectMCPs(projectId: string) {
    const projectMCPs = await this.prisma.projectMCP.findMany({
      where: { projectId },
      include: { mcp: true },
    });
    return projectMCPs.map(pm => pm.mcp);
  }
}
