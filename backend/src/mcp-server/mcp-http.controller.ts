import { Controller, Post, Get, Delete, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServerService } from './mcp-server.service';
import { McpToolsFactory } from './mcp-tools.factory';

/**
 * MCP real (JSON-RPC 2.0 / Streamable HTTP) em modo stateless:
 * um servidor+transporte novo por request, identidade via Bearer mcpToken.
 * É neste endpoint que os CLIs (claude, opencode, ...) se conectam.
 */
@Controller('mcp')
export class McpHttpController {
  constructor(
    private readonly mcpService: McpServerService,
    private readonly toolsFactory: McpToolsFactory,
  ) {}

  private extractToken(req: Request): string {
    const header = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header);
    return match ? match[1].trim() : '';
  }

  @Post()
  async handlePost(@Req() req: Request, @Res() res: Response) {
    const token = this.extractToken(req);
    const session = await this.mcpService.resolveToken(token);
    const masterState = session ? null : await this.mcpService.resolveMasterToken(token);
    if (!session && !masterState) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: invalid or missing bearer token' },
        id: null,
      });
      return;
    }

    const server = session
      ? this.toolsFactory.create(session.id)
      : this.toolsFactory.createMaster(masterState!);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: `Internal error: ${error.message}` },
          id: null,
        });
      }
    }
  }

  // Modo stateless: GET (stream SSE de servidor) e DELETE (fim de sessão MCP)
  // não são suportados — respondemos como manda a spec.
  @Get()
  handleGet(@Res() res: Response) {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed: stateless transport' },
      id: null,
    });
  }

  @Delete()
  handleDelete(@Res() res: Response) {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed: stateless transport' },
      id: null,
    });
  }
}
