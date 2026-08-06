<#
.SYNOPSIS
  Inicializa um novo projeto baseado no template ia-framework.
  Wizard stdin: pergunta stacks ativas, edita ia-framework/STACK.md, cria pastas,
  printa próximos passos.

  Uso:
    .\init.ps1            # wizard interativo
    .\init.ps1 -Quiet     # defaults silenciosos (todas as stacks)
#>

param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Get-Location).Path
$stackPath = Join-Path $repoRoot 'ia-framework\STACK.md'

if (-not (Test-Path -LiteralPath $stackPath)) {
  Write-Host "Erro: ia-framework\STACK.md nao encontrado em $repoRoot" -ForegroundColor Red
  Write-Host "Voce esta rodando init.ps1 na raiz do template clone?" -ForegroundColor Yellow
  exit 1
}

function Ask-Yes($prompt, $default = $true) {
  if ($Quiet) { return $default }
  $defaultHint = if ($default) { '[Y/n]' } else { '[y/N]' }
  Write-Host ("$prompt $defaultHint ") -NoNewline
  # Le stdin via Console (funciona em pipe e interativo)
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { Write-Host ''; return $default }
  $resp = $line.Trim().ToLower()
  if (-not $resp) { return $default }
  return $resp -eq 'y' -or $resp -eq 's' -or $resp -eq 'sim'
}

Write-Host "=== Inicializacao de projeto baseado em ia-framework ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tip: para setup 100% conversacional, rode `/init` no seu orquestrador" -ForegroundColor DarkGray
Write-Host "(opencode ou Claude Code) em vez deste script. Esta versao .ps1 fica como" -ForegroundColor DarkGray
Write-Host "alternativa terminal para orquestradores sem filesystem access." -ForegroundColor DarkGray
Write-Host ""

# Stacks ativas (default pergunta)
$angular  = Ask-Yes "Ativar Angular 22 (frontend)?          " $true
$nodejs   = Ask-Yes "Ativar Node.js 22+ (backend)?          " $true
$spring   = Ask-Yes "Ativar Spring Boot 3.5 (backend)?     " $false
$go       = Ask-Yes "Ativar Go 1.23+ (backend)?            " $false
$postgres = Ask-Yes "Ativar PostgreSQL 16+ (banco)?        " $true

# Cria pastas do projeto
$dirs = @('project_sdd', 'docs\architecture', 'docs\testing', 'req', 'req\screens', 'examples')
foreach ($d in $dirs) {
  $p = Join-Path $repoRoot $d
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
    Write-Host "  pasta criada: $d" -ForegroundColor Green
  } else {
    Write-Host "  pasta ja existe: $d" -ForegroundColor DarkGray
  }
}

# Ajusta STACK.md
$content = Get-Content -LiteralPath $stackPath -Raw
$lines = @()
$lines += '---'
$lines += 'purpose: Manifesto de stacks ativas neste monorepo. Lido pelos agentes/commands da ia-framework para selecionar a skill correta quando o chamador nao explicita a stack.'
$lines += "updated: $(Get-Date -Format 'yyyy-MM-dd')"
$lines += '---'
$lines += ''
$lines += '# Manifesto de Stacks'
$lines += ''
$lines += '## Frontend'
if ($angular) {
  $lines += ''
  $lines += '- **angular** - Angular 22 (standalone, signals, novo control flow, zoneless)'
  $lines += '  - Raiz do codigo: `frontend/`'
  $lines += '  - Skill: `skills/stacks/angular/SKILL.md`'
}
$lines += ''
$lines += '## Backend (escolha um ou mais)'
if ($nodejs) {
  $lines += ''
  $lines += '- **nodejs** - Node.js 22+ (ESM, Fastify/Express5/NestJS)'
  $lines += '  - Raiz do codigo: `backend/nodejs/`'
  $lines += '  - Skill: `skills/stacks/nodejs/SKILL.md`'
}
if ($spring) {
  $lines += ''
  $lines += '- **spring** - Java 21+ / Spring Boot 3.5 (virtual threads, Jakarta, Spring Security 6)'
  $lines += '  - Raiz do codigo: `backend/spring/`'
  $lines += '  - Skill: `skills/stacks/spring/SKILL.md`'
}
if ($go) {
  $lines += ''
  $lines += '- **go** - Go 1.23+ (modulos, context-first, interfaces no consumer-side)'
  $lines += '  - Raiz do codigo: `backend/go/`'
  $lines += '  - Skill: `skills/stacks/go/SKILL.md`'
}
$lines += ''
$lines += '## Banco de Dados'
if ($postgres) {
  $lines += ''
  $lines += '- **postgres** - PostgreSQL 16+ (RLS, particionamento declarativo, JSONB+GIN, Flyway)'
  $lines += '  - Raiz do codigo: `BD/`'
  $lines += '  - Skill: `skills/stacks/postgres/SKILL.md`'
}
$lines += ''
$lines += '## Convecoes'
$lines += ''
$lines += '- Stack ausente neste manifesto = agente recusa a tarefa e pede para o usuario escolher.'
$lines += '- Mais de uma stack de backend ativa e valido - cada agente fica restrito a sua raiz.'
$lines += '- Quando o chamador passa `--stack=<id>` num comando, esta lista e ignorada para aquela'
$lines += '  invocacao (escolha explicita vence inferencia).'
$lines += ''

Set-Content -LiteralPath $stackPath -Value ($lines -join "`r`n") -Encoding utf8
Write-Host ""
Write-Host "STACK.md atualizado." -ForegroundColor Green

# Cria arvore SDD (se ainda nao existe)
$sddRoot = Join-Path $repoRoot 'project_sdd'
$stackScript = Join-Path $repoRoot 'ia-framework\skills\scaffold.ps1'
if (-not (Test-Path -LiteralPath (Join-Path $sddRoot '01-context'))) {
  Write-Host ""
  Write-Host "Criando arvore SDD em $sddRoot ..." -ForegroundColor Cyan
  & powershell -NoProfile -ExecutionPolicy Bypass -File $stackScript init $sddRoot
} else {
  Write-Host "Arvore SDD ja existe em $sddRoot - mantida." -ForegroundColor DarkGray
}

# === QMD opcional (busca semantica local) ===
$qmdInstalled = $false
if (-not $Quiet) {
  Write-Host ""
  Write-Host '=== QMD (opcional - busca semantica local) ===' -ForegroundColor Cyan
  Write-Host "QMD indexa seus .md com BM25 + vector + LLM reranking (~2GB modelos no primeiro uso)."
  Write-Host "Indice curado (INDEX.md) cobre 99% dos usos; QMD soma valor para busca semantica."
  $installQmd = Ask-Yes "Instalar QMD agora (npm/bun/npx auto-detect; baixa ~2GB)?" $false
  if ($installQmd) {
    # Auto-detect prioridade: npm -> bun -> npx
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    $bun = Get-Command bun -ErrorAction SilentlyContinue
    if ($npm) {
      Write-Host "  Detectado npm. Instalando @tobilu/qmd global..." -ForegroundColor Yellow
      & npm install -g "@tobilu/qmd" 2>&1 | ForEach-Object { Write-Host "    $_" }
    } elseif ($bun) {
      Write-Host "  Detectado bun. Instalando @tobilu/qmd global..." -ForegroundColor Yellow
      & bun install -g "@tobilu/qmd" 2>&1 | ForEach-Object { Write-Host "    $_" }
    } else {
      Write-Host "  Nem npm nem bun encontrados." -ForegroundColor Red
      Write-Host "  Instale Node.js 22+ (https://nodejs.org) ou Bun 1+ (https://bun.sh)" -ForegroundColor Yellow
      Write-Host "  Depois rode: npm install -g @tobilu/qmd  (ou bun install -g @tobilu/qmd)" -ForegroundColor Yellow
      Write-Host '  Pulando instalacao QMD - restante do init continua.' -ForegroundColor DarkGray
    }
    if ($npm -or $bun) {
      # Confirma instalacao
      $qmdBin = Get-Command qmd -ErrorAction SilentlyContinue
      if ($qmdBin) {
        Write-Host "  QMD instalado: $($qmdBin.Source)" -ForegroundColor Green
        & qmd --version 2>&1 | ForEach-Object { Write-Host "    versao: $_" }

        # qmd init (project-local .qmd/)
        Write-Host "  Rodando qmd init (project-local .qmd/)..." -ForegroundColor Yellow
        & qmd init 2>&1 | ForEach-Object { Write-Host "    $_" }

        # .gitignore para .qmd/
        $gitignore = Join-Path $repoRoot '.gitignore'
        $gitignoreContent = if (Test-Path -LiteralPath $gitignore) { Get-Content -LiteralPath $gitignore -Raw } else { '' }
        if ($gitignoreContent -notmatch '\.qmd/') {
          Add-Content -LiteralPath $gitignore -Value "`n# QMD project-local index (binario, grande)`n.qmd/" -Encoding utf8
          Write-Host "  .gitignore atualado com .qmd/" -ForegroundColor Green
        }

        # Collections (apenas pastas que existem)
        $collections = @(
          @{ path = 'project_sdd\01-context';   name = 'context' },
          @{ path = 'project_sdd\02-specs';      name = 'specs' },
          @{ path = 'project_sdd\03-decisions';  name = 'adrs' },
          @{ path = 'docs\architecture';          name = 'arch' },
          @{ path = 'docs\testing';              name = 'tests' }
        )
        foreach ($c in $collections) {
          $fullPath = Join-Path $repoRoot $c.path
          if (Test-Path -LiteralPath $fullPath) {
            Write-Host "  qmd collection add $($c.path) --name $($c.name)" -ForegroundColor Yellow
            & qmd collection add $fullPath --name $c.name --mask "**/*.md" 2>&1 | ForEach-Object { Write-Host "    $_" }
          }
        }

        # Contexto descritivo (melhora relevancia)
        Write-Host "  qmd context add (descricoes de colecao)..." -ForegroundColor Yellow
        & qmd context add qmd://context "Memoria viva do projeto SDD" 2>&1 | Out-Null
        & qmd context add qmd://specs   "Trilhas SDD com spec + tarefas" 2>&1 | Out-Null
        & qmd context add qmd://arch    "Snapshot de arquitetura per-release" 2>&1 | Out-Null

        # Embed (~2GB download + indexacao - pesado)
        Write-Host "  Rodando qmd embed (baixa ~2GB de modelos GGUF no primeiro run)..." -ForegroundColor Yellow
        Write-Host "  Isso pode levar 5-15 min dependendo da banda e hardware." -ForegroundColor DarkGray
        & qmd embed 2>&1 | ForEach-Object { Write-Host "    $_" }

        # Status final
        Write-Host "  === QMD status ===" -ForegroundColor Cyan
        & qmd status 2>&1 | ForEach-Object { Write-Host "    $_" }
        $qmdInstalled = $true
      } else {
        Write-Host "  qmd nao encontrado no PATH apos install." -ForegroundColor Red
        Write-Host "  Tente reabrir o terminal ou rode 'npm install -g @tobilu/qmd' manualmente." -ForegroundColor Yellow
      }
    }
  } else {
    Write-Host "  QMD pulado. Para instalar depois:" -ForegroundColor DarkGray
    Write-Host "    npm install -g @tobilu/qmd" -ForegroundColor DarkGray
    Write-Host "    qmd init && qmd collection add project_sdd/01-context --name context" -ForegroundColor DarkGray
    Write-Host "    qmd embed  (baixa ~2GB modelos)" -ForegroundColor DarkGray
    Write-Host "  Detalhes: ia-framework/skills/memory/references/qmd-optional.md" -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host "=== Inicializacao completa ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Proximos passos:"
Write-Host ""
Write-Host "  A) Documento de requisitos .docx/.pdf/.md:"
Write-Host "     1. Copie o requisito para req/"
Write-Host "     2. Rode: /plan-from-requirements req/<seu-arquivo>"
Write-Host ""
Write-Host "  B) Telas visuais + documento:"
Write-Host "     1. Copie .png para req/screens/"
Write-Host "     2. Rode: /load-screens req/screens/   (anexe imagenis no prompt)"
Write-Host "     3. Rode: /plan-from-requirements req/<seu-arquivo>"
Write-Host ""
Write-Host '  C) Prompt curto (sem documento):'
Write-Host '     Rode: /plan-from-prompt "<sua descricao curta>"'
Write-Host '     Protocolo de aprovacao em 4 fases antes de executar.'
Write-Host ''
Write-Host '  D) Bug pontual:'
Write-Host '     Rode: /sdd-bug-fix <slug-do-bug>'
Write-Host ''
Write-Host 'Apos gerar plano, execute cada trilha com /sdd --stack=<id> <tipo> <slug>.'
Write-Host 'Ao final de um eixo: /tests-release --stack=all + /generate-architecture --stack=all.'
Write-Host ''
if ($qmdInstalled) {
  Write-Host 'QMD: instalado e indexado. Use "qmd search <termo>" para busca semantica.' -ForegroundColor Green
} else {
  Write-Host 'QMD: nao instalado (indice curado INDEX.md cobre 99% dos usos).' -ForegroundColor DarkGray
}
Write-Host ''
Write-Host 'Consulte README.md e docs/USAGE.md para detalhes.' -ForegroundColor Cyan