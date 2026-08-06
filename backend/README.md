# Orchestrator Backend

AI Development Orchestrator - Backend API

## Setup

Roda em Windows, Linux e macOS. Para subir o stack inteiro de uma vez, use
`..\setup.ps1` (Windows) ou `../setup.sh` (Linux/macOS) na raiz do repo — os
passos abaixo são o equivalente manual só do backend.

1. Start PostgreSQL and Redis:
```bash
cd backend
docker compose up -d
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment file — `cp .env.example .env` (ou `copy .env.example .env`)

4. Generate Prisma client:
```bash
npx prisma generate
```

5. Run migrations:
```bash
npx prisma migrate dev
```

6. Start development server:
```bash
npm run start:dev
```

API will be available at `http://localhost:4000`

### Runtime das sessões (sem tmux)

Cada sessão de agente roda num PTY criado pelo `PtySessionRegistry`
(`src/session-runtime/pty-session.registry.ts`) — ConPTY no Windows, PTY normal
no resto. Ele faz o papel que o servidor tmux fazia: cria o processo com cwd e
env, espelha a tela num `@xterm/headless` (é de lá que sai o `capturePane`,
antigo `capture-pane -p`) e multiplexa o stream para N clientes anexados.

Uma consequência operacional: **o pane é filho do processo do backend**, então
reiniciar o backend derruba todas as sessões de agente. Elas voltam marcadas
`stalled` e são retomáveis pela UI. Com tmux o CLI sobrevivia ao restart e o
backend reanexava; isso não existe mais. Por isso `start:clean` (sem `--watch`)
continua sendo o modo certo de rodar quando o orquestrador está orquestrando a
si mesmo.

## API Endpoints

### Projects
- `GET /projects` - List all projects
- `GET /projects/:id` - Get project details
- `POST /projects` - Create project
- `PATCH /projects/:id` - Update project
- `DELETE /projects/:id` - Delete project

### Pipelines
- `GET /projects/:projectId/pipelines` - List pipelines
- `GET /projects/:projectId/pipelines/:id` - Get pipeline
- `POST /projects/:projectId/pipelines` - Create pipeline
- `PATCH /projects/:projectId/pipelines/:id` - Update pipeline
- `DELETE /projects/:projectId/pipelines/:id` - Delete pipeline

### Macro Tasks
- `GET /projects/:projectId/macro-tasks` - List macro tasks
- `GET /projects/:projectId/macro-tasks/:id` - Get macro task
- `POST /projects/:projectId/macro-tasks` - Create macro task
- `PATCH /projects/:projectId/macro-tasks/:id` - Update macro task
- `DELETE /projects/:projectId/macro-tasks/:id` - Delete macro task

### Sessions
- `GET /sessions` - List all sessions
- `GET /sessions/:id` - Get session details
- `POST /sessions` - Create session
- `PATCH /sessions/:id` - Update session
- `DELETE /sessions/:id` - Delete session

### Questions
- `GET /sessions/:sessionId/questions` - List questions
- `GET /sessions/:sessionId/questions/:id` - Get question
- `POST /sessions/:sessionId/questions` - Create question
- `PATCH /sessions/:sessionId/questions/:id/answer` - Answer question
- `DELETE /sessions/:sessionId/questions/:id` - Delete question

### Logs
- `GET /logs` - List logs (optional: ?sessionId= or ?projectId=)
- `GET /logs/:id` - Get log entry
- `POST /logs` - Create log entry

## Architecture

- **NestJS 11** - Backend framework
- **Prisma** - ORM with PostgreSQL
- **Redis** - Real-time pub/sub and caching
- **SimpleGit** - Git worktree management
- **LLM Abstraction** - OpenAI, Anthropic, Ollama support

## Modules

- `projects` - Project management
- `pipelines` - Pipeline DSL and stages
- `macro-tasks` - Task breakdown
- `sessions` - Development sessions
- `questions` - Q&A workflow
- `workspace` - Git worktree operations
- `llm` - LLM provider abstraction
- `mcp-server` - MCP tools for agents
- `master-agent` - Orchestration logic
- `scheduler` - Cron jobs and scheduling
- `logs` - Activity logging
