# QMD opcional — busca semântica local

[QMD](https://github.com/tobi/qmd) é search engine local para Markdown/docs com BM25,
vector semantic e LLM reranking — roda on-device via `node-llama-cpp` com modelos GGUF.
Ideal para projetos com muitas `.md` em `01-context/`, `02-specs/`, `03-decisions/`,
`docs/architecture/`, `docs/testing/`. Índice curado (`INDEX.md` ~500 tokens) cobre 99%
dos usos; QMD soma valor quando você precisa de busca semântica ("decisões que afetam
Angular e Postgres juntos").

## Requisitos

- **Node.js ≥ 22** **OU** **Bun ≥ 1.0.0** (qualquer um serve — não precisa dos dois)
- **macOS**: `brew install sqlite` (extensões SQLite para sqlite-vec)
- **Linux/Windows/WSL**: sem deps adicionais além de Node/Bun

Modelos GGUF (~2GB total) são auto-baixados no primeiro `qmd embed`:

| Modelo | Papel | Tamanho |
| ------ | ----- | ------- |
| `embeddinggemma-300M-Q8_0` | Embeddings vetoriais (default) | ~300MB |
| `qwen3-reranker-0.6b-q8_0` | Re-ranking LLM | ~640MB |
| `qmd-query-expansion-1.7B-gguf` | Expansão de query (fine-tuned) | ~1.1GB |

Cache: `~/.cache/qmd/models/` (override via `XDG_CACHE_HOME`). Índice SQLite:
`~/.cache/qmd/index.sqlite` (global) ou `.qmd/index.sqlite` se `qmd init` (project-local).

## Instalação (3 caminhos)

### 1. npm (preferencial — cross-OS, qualquer Node 22+)

```bash
npm install -g @tobilu/qmd
```

### 2. bun (alternativa — macOS/Linux, startup mais rápido)

```bash
bun install -g @tobilu/qmd
```

### 3. npx (sem instalar — testa antes de comprometer)

```bash
npx @tobilu/qmd search "authentication"
# Equivale a "qmd search ..." temporário, baixa cache local mas não global binary.
```

> **Dica:** `init.ps1`/`init.sh` perguntam se você quer instalar QMD durante o bootstrap
> do template. Se aceitar, escolhe npm/bun/npx via auto-detect e roda `qmd init` +
> collections + `qmd embed` automaticamente. Se pular, rode os comandos abaixo
> manualmente quando quiser.

## Diagnóstico: `qmd doctor`

```bash
qmd doctor
# Confere runtime, sqlite-vec, fingerprints de modelos, GPU probe.
# Output indentifica o que falta antes de rodar embed.
```

## Configuração project-local (`qmd init`)

Preferido quando você quer config e índice dentro do repo (em vez de global em `~/.cache`):

```bash
cd /path/to/project
qmd init
# Cria .qmd/index.yml (config) e .qmd/index.sqlite (índice)
# .qmd/ DEVE estar em .gitignore — index.sqlite é binário e grande.
```

Alternativa sem `qmd init`: config global em `~/.config/qmd/index.yml`.

## Adicionar coleções

```bash
qmd collection add project_sdd/01-context --name context      --mask "**/*.md"
qmd collection add project_sdd/02-specs   --name specs        --mask "**/*.md"
qmd collection add project_sdd/03-decisions --name adrs       --mask "**/*.md"
qmd collection add docs/architecture       --name arch         --mask "**/*.md"
qmd collection add docs/testing            --name tests        --mask "**/*.md"

# Contexto descritivo melhora relevância (LLM usa na seleção)
qmd context add qmd://context "Memória viva do projeto SDD"
qmd context add qmd://specs   "Trilhas SDD com spec + tarefas"
qmd context add qmd://arch    "Snapshot de arquitetura per-release"
```

## Gerar embeddings (~2GB download no primeiro run)

```bash
qmd embed
# Baixa 3 modelos GGUF e indexa tudo. Pesado — correpto em ambiente com banda.
# Subsequente: só reroda se novos arquivos surgirem.

qmd embed -f                    # forçar re-embed tudo (após mudar modelo)

qmd embed --chunk-strategy auto # AST-aware chunking para código (TS/JS/Python/Go/Rust)
                                # tree-sitter opcional; fallback regex se ausente.
```

## Consultar (seguro em sessão SDD — read-only)

```bash
qmd search "auth jwt rotation"              # BM25, instant
qmd vsearch "isolamento tenant em BD"      # semântico, ~1min cold start
qmd query "decisões que afetam auth e BD"   # híbrido + rerank, melhor qualidade
qmd status                                  # saúde do índice (read-only)
qmd doctor                                  # diagnóstico (read-only)
qmd get "02-specs/001-orders-api/spec.md"  # documento completo
qmd multi-get "02-specs/*/*.md"             # batch
```

Output para agentes (`--json` é mais amigável):

```bash
qmd search "orders api" --json -n 5
qmd query "auth" --all --files --min-score 0.4
qmd query "auth" --json --explain          # score breakdown (RRF + rerank)
```

## Servidor MCP (opcional, integração com Claude/Cursor)

QMD expõe MCP server via stdio (default) ou HTTP:

```bash
qmd mcp                                      # stdio (subprocess)
qmd mcp --http --port 8181                   # HTTP shared (modelos quentes em VRAM)
qmd mcp --http --daemon                      # background (PID em ~/.cache/qmd/mcp.pid)
qmd mcp stop                                 # stop via PID
qmd status                                   # mostra "MCP: running (PID ...)" se ativo
```

Heroes do HTTP mode: LLM models ficam quentes em VRAM entre requests;cold-start de
embed/rerank é ~1s mas modelos não recarregam. Útil para ambiente de agente que faz
muitas queries rápidas.

Configuração Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{ "mcpServers": { "qmd": { "command": "qmd", "args": ["mcp"] } } }
```

## Modelo de embedding multilingual (CJK)

Para corpora chinês/japonês/coreano, o default `embeddinggemma-300M` tem cobertura
limitada. Troque por Qwen3-Embedding-0.6B (MTEB top-rank, 119 línguas):

```bash
export QMD_EMBED_MODEL="hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf"
qmd embed -f    # precisa re-embed tudo — vetores não são cross-modelo
```

## Quando usar

- Antes de mergulhar em `01-context/` se busca palavra-chave falhar.
- Para pergunta transversal entre stacks ("decisões que afetam Angular e Postgres juntos").
- Em sessão paralela de debug: `qmd search "orders api" --files` para achar paths sem
  abrir diffs.
- Nunca dentro de hot-path de render/loop — cold start de semantic é caro.

## Quando NÃO usar

- Default: `Read project_sdd/INDEX.md` primeiro. Cobre a maioria.
- Em sessões SDD paralelas **não rode `qmd embed`** — pode travar usuário (carga de
  CPU/GPU por minutos). Reserve para:
  - Job de backend do projeto
  - Botão "Reindex" em dashboard
  - Script `init.ps1`/`init.sh` (com confirmação explícita)
  - CI serializado com cache de `~/.cache/qmd/models/` e `~/.cache/qmd/index.sqlite`
- Em CI sem cache pré-aquecido: `qmd embed` pode estourar timeout (≥10min em cold start
  + 2GB download). Mitigação: PR separado que roda embed fora do timeout default.
- Em Windows sem WSL: `npm install -g @tobilu/qmd` funciona (Testes @tobilu/qmd em
  Node 22+ Windows), mas alguns drivers de GPU podem ter compatibilidade variável
  com `node-llama-cpp`. Se erro no embed, rode `qmd doctor` e reporte.

## Fallback gracioso

Se `qmd` ausente (`command -v qmd`/`Get-Command qmd` falha), scripts e agentes
silenciosamente caem para `grep -rn` + `INDEX.md` e reportam. Nunca instalar
automaticamente sem confirmação.

## Manutenção de índice

```bash
qmd update                    # re-indexar filesystem (cada `qmd update` roda hook
                              # `update: "git pull"` se configurado por collection)
qmd cleanup                   # limpar cache e dados órfãos
qmd collection update-cmd context 'git pull --rebase'  # hook antes de update
```

## Referência de comandos

| Comando | R/W | Quando rodar em sessão SDD |
| ------- | --- | --------------------------- |
| `qmd status` | read | sempre que precisar saber saúde |
| `qmd doctor` | read | quando algo parece errado (embed falha) |
| `qmd search/vsearch/query` | read | em sessão para lookup semântico |
| `qmd get/multi-get` | read | para recuperar conteúdo de doc por path/docid |
| `qmd collection add/context add` | write | antes de `qmd embed` |
| `qmd embed` | write (pesado) | **NÃO em sessão SDD paralela** sem lock |
| `qmd update` | write (pesado) | pro ambiente de orquestrador, não em sessão |
| `qmd cleanup` | write | raramente, em manutenção |
| `qmd mcp` | server | só orquestrador/CI, não em sessão |

## Não faça

- Não rode `qmd embed` em sessão SDD sem confirmação — 2GB download + CPU alto.
- Não commite `.qmd/index.sqlite` (binário, grande) — `.gitignore` no `init.ps1`.
- Não persista tokens JWT longa vida em `index.yml` (se algum `update:` hook usa auth).
- Não dependa de `qmd` para flow crítico — fallback `grep -rn` sempre disponível.