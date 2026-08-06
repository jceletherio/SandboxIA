#!/usr/bin/env bash
# Inicializa um novo projeto baseado no template ia-framework.
# Wizard stdin: pergunta stacks ativas, edita ia-framework/STACK.md, cria pastas,
# printa proximos passos.
#
# Uso:
#   ./init.sh            # wizard interativo
#   ./init.sh --quiet    # defaults silenciosos (todas as stacks)

set -euo pipefail

repo_root="$(pwd)"
stack_path="$repo_root/ia-framework/STACK.md"

if [[ ! -f "$stack_path" ]]; then
  echo "Erro: ia-framework/STACK.md nao encontrado em $repo_root" >&2
  echo "Voce esta rodando init.sh na raiz do template clone?" >&2
  exit 1
fi

QUIET=""
if [[ "${1:-}" == "--quiet" || "${1:-}" == "-q" ]]; then QUIET=1; fi

ask_yes() {
  local prompt="$1"; local default="${2:-y}"
  local hint=""; [[ "$default" == "y" ]] && hint="[Y/n]" || hint="[y/N]"
  if [[ -n "$QUIET" ]]; then
    [[ "$default" == "y" ]] && return 0 || return 1
  fi
  read -rp "$prompt $hint " resp
  resp="${resp,,}"
  [[ -z "$resp" ]] && { [[ "$default" == "y" ]] && return 0 || return 1; }
  [[ "$resp" == "y" || "$resp" == "s" || "$resp" == "sim" ]]
}

echo "=== Inicializacao de projeto baseado em ia-framework ==="
echo ""
echo "Tip: para setup 100% conversacional, rode /init no seu orquestrador"
echo "(opencode ou Claude Code) em vez deste script. Esta versao .sh fica como"
echo "alternativa terminal para orquestradores sem filesystem access."
echo ""

angular="n"; nodejs="n"; spring="n"; go="n"; postgres="n"
ask_yes "Ativar Angular 22 (frontend)?          " y && angular="y"
ask_yes "Ativar Node.js 22+ (backend)?          " y && nodejs="y"
ask_yes "Ativar Spring Boot 3.5 (backend)?      " n && spring="y"
ask_yes "Ativar Go 1.23+ (backend)?             " n && go="y"
ask_yes "Ativar PostgreSQL 16+ (banco)?         " y && postgres="y"

# Cria pastas
for d in project_sdd docs/architecture docs/testing req req/screens examples; do
  if [[ ! -d "$repo_root/$d" ]]; then
    mkdir -p "$repo_root/$d"
    echo "  pasta criada: $d"
  else
    echo "  pasta ja existe: $d"
  fi
done

# STACK.md
{
  echo '---'
  echo 'purpose: Manifesto de stacks ativas neste monorepo. Lido pelos agentes/commands da ia-framework para selecionar a skill correta quando o chamador nao explicita a stack.'
  echo "updated: $(date +%Y-%m-%d)"
  echo '---'
  echo ''
  echo '# Manifesto de Stacks'
  echo ''
  echo '## Frontend'
  if [[ "$angular" == "y" ]]; then
    echo ''
    echo '- **angular** - Angular 22 (standalone, signals, novo control flow, zoneless)'
    echo '  - Raiz do codigo: `frontend/`'
    echo '  - Skill: `skills/stacks/angular/SKILL.md`'
  fi
  echo ''
  echo '## Backend (escolha um ou mais)'
  if [[ "$nodejs" == "y" ]]; then
    echo ''
    echo '- **nodejs** - Node.js 22+ (ESM, Fastify/Express5/NestJS)'
    echo '  - Raiz do codigo: `backend/nodejs/`'
    echo '  - Skill: `skills/stacks/nodejs/SKILL.md`'
  fi
  if [[ "$spring" == "y" ]]; then
    echo ''
    echo '- **spring** - Java 21+ / Spring Boot 3.5 (virtual threads, Jakarta, Spring Security 6)'
    echo '  - Raiz do codigo: `backend/spring/`'
    echo '  - Skill: `skills/stacks/spring/SKILL.md`'
  fi
  if [[ "$go" == "y" ]]; then
    echo ''
    echo '- **go** - Go 1.23+ (modulos, context-first, interfaces no consumer-side)'
    echo '  - Raiz do codigo: `backend/go/`'
    echo '  - Skill: `skills/stacks/go/SKILL.md`'
  fi
  echo ''
  echo '## Banco de Dados'
  if [[ "$postgres" == "y" ]]; then
    echo ''
    echo '- **postgres** - PostgreSQL 16+ (RLS, particionamento declarativo, JSONB+GIN, Flyway)'
    echo '  - Raiz do codigo: `BD/`'
    echo '  - Skill: `skills/stacks/postgres/SKILL.md`'
  fi
  echo ''
  echo '## Convecoes'
  echo ''
  echo '- Stack ausente neste manifesto = agente recusa a tarefa e pede para o usuario escolher.'
  echo '- Mais de uma stack de backend ativa e valido - cada agente fica restrito a sua raiz.'
  echo '- Quando o chamador passa `--stack=<id>` num comando, esta lista e ignorada para aquela'
  echo '  invocacao (escolha explicita vence inferencia).'
  echo ''
} > "$stack_path"
echo ""
echo "STACK.md atualizado."

# Arvore SDD
sdd_root="$repo_root/project_sdd"
scaffold="$repo_root/ia-framework/skills/scaffold.sh"
if [[ ! -d "$sdd_root/01-context" ]]; then
  echo ""
  echo "Criando arvore SDD em $sdd_root ..."
  if [[ -f "$scaffold" ]]; then
    SDD_ROOT="$sdd_root" bash "$scaffold" init "$sdd_root"
  else
    mkdir -p "$sdd_root/01-context" "$sdd_root/02-specs" "$sdd_root/03-decisions"
  fi
else
  echo "Arvore SDD ja existe em $sdd_root - mantida."
fi

# === QMD opcional (busca semantica local) ===
QMD_INSTALLED=0
if [[ -z "$QUIET" ]]; then
  echo ""
  echo "=== QMD (opcional — busca semantica local) ==="
  echo "QMD indexa seus .md com BM25 + vector + LLM reranking (~2GB modelos no primeiro uso)."
  echo "Indice curado (INDEX.md) cobre 99% dos usos; QMD soma valor para busca semantica."
  if ask_yes "Instalar QMD agora (npm/bun auto-detect; baixa ~2GB)?" n; then
    # Auto-detect: npm -> bun -> npx
    if command -v npm >/dev/null 2>&1; then
      echo "  Detectado npm. Instalando @tobilu/qmd global..."
      npm install -g @tobilu/qmd
    elif command -v bun >/dev/null 2>&1; then
      echo "  Detectado bun. Instalando @tobilu/qmd global..."
      bun install -g @tobilu/qmd
    else
      echo "  Nem npm nem bun encontrados."
      echo "  Instale Node.js 22+ (https://nodejs.org) ou Bun 1+ (https://bun.sh)"
      echo "  Depois rode: npm install -g @tobilu/qmd  (ou bun install -g @tobilu/qmd)"
      echo "  Pulando instalacao QMD — restante do init continua."
    fi
    if command -v qmd >/dev/null 2>&1; then
      echo "  QMD instalado: $(command -v qmd)"
      qmd --version 2>&1 | sed 's/^/    versao: /'

      echo "  Rodando qmd init (project-local .qmd/)..."
      qmd init

      # .gitignore para .qmd/
      gitignore="$repo_root/.gitignore"
      if ! grep -q '\.qmd/' "$gitignore" 2>/dev/null; then
        printf '\n# QMD project-local index (binario, grande)\n.qmd/\n' >> "$gitignore"
        echo "  .gitignore atualado com .qmd/"
      fi

      # Collections (apenas pastas que existem)
      add_collection() {
        local p="$1"; local name="$2"
        if [[ -d "$repo_root/$p" ]]; then
          echo "  qmd collection add $p --name $name"
          qmd collection add "$repo_root/$p" --name "$name" --mask "**/*.md"
        fi
      }
      add_collection "project_sdd/01-context"  "context"
      add_collection "project_sdd/02-specs"    "specs"
      add_collection "project_sdd/03-decisions" "adrs"
      add_collection "docs/architecture"        "arch"
      add_collection "docs/testing"            "tests"

      # Contexto descritivo (melhora relevancia)
      echo "  qmd context add (descricoes de colecao)..."
      qmd context add qmd://context "Memoria viva do projeto SDD" 2>/dev/null || true
      qmd context add qmd://specs   "Trilhas SDD com spec + tarefas" 2>/dev/null || true
      qmd context add qmd://arch    "Snapshot de arquitetura per-release" 2>/dev/null || true

      # Embed (~2GB download + indexacao — pesado)
      echo "  Rodando qmd embed (baixa ~2GB de modelos GGUF no primeiro run)..."
      echo "  Isso pode levar 5-15 min dependendo da banda e hardware."
      qmd embed

      # Status final
      echo "  === QMD status ==="
      qmd status
      QMD_INSTALLED=1
    else
      echo "  qmd nao encontrado no PATH apos install."
      echo "  Tente reabrir o terminal ou rode 'npm install -g @tobilu/qmd' manualmente."
    fi
  else
    echo "  QMD pulado. Para instalar depois:"
    echo "    npm install -g @tobilu/qmd"
    echo "    qmd init && qmd collection add project_sdd/01-context --name context"
    echo "    qmd embed  (baixa ~2GB modelos)"
    echo "  Detalhes: ia-framework/skills/memory/references/qmd-optional.md"
  fi
fi

echo ""
echo "=== Inicializacao completa ==="
echo ""
echo "Proximos passos:"
echo ""
echo "  A) Documento de requisitos .docx/.pdf/.md:"
echo "     1. Copie o requisito para req/"
echo "     2. Rode: /plan-from-requirements req/<seu-arquivo>"
echo ""
echo "  B) Telas visuais + documento:"
echo "     1. Copie .png para req/screens/"
echo "     2. Rode: /load-screens req/screens/   (anexe imagens no prompt)"
echo "     3. Rode: /plan-from-requirements req/<seu-arquivo>"
echo ""
echo "  C) Prompt curto (sem documento):"
echo "     Rode: /plan-from-prompt \"<sua descricao curta>\""
echo "     Protocolo de aprovacao em 4 fases antes de executar."
echo ""
echo "  D) Bug pontual:"
echo "     Rode: /sdd-bug-fix <slug-do-bug>"
echo ""
echo "Apos gerar plano, execute cada trilha com /sdd --stack=<id> <tipo> <slug>."
echo "Ao final de um eixo: /tests-release --stack=all + /generate-architecture --stack=all."
echo ""
if [[ "$QMD_INSTALLED" == "1" ]]; then
  echo 'QMD: instalado e indexado. Use "qmd search <termo>" para busca semantica.'
else
  echo 'QMD: nao instalado (indice curado INDEX.md cobre 99% dos usos).'
fi
echo ""
echo "Consulte README.md e docs/USAGE.md para detalhes."