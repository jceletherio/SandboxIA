<#
.SYNOPSIS
  Scaffold da árvore SDD Enxuto (multi-stack) — versão PowerShell 5.1+.

.DESCRIPTION
  Mesma CLI do scaffold.sh. Cria/mantém a árvore:
    <SDD_ROOT>/
      STATUS.md
      01-context/   (templates copiados no init)
      02-specs/
      03-decisions/
  Comandos:
    init <root>             cria a árvore vazia + STATUS.md + templates de contexto
    new <tipo> [NNN] <slug> cria 02-specs/{NNN}-{slug}/ e copia spec-template.md
    harvest [raiz]          lista .md da app (fora do SDD) com front-matter + outline
    context <refs>          resolve referências arquivo:linha em trechos curtos
    index [--write]         refaz STATUS.md a partir de 02-specs/
    migrate [--write]       converte árvore antiga (9 dirs) para layout enxuto

  Use via:  powershell -File scaffold.ps1 <cmd> [args...]
            ou     pwsh -File scaffold.ps1 <cmd> [args...]
#>

param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$ErrorActionPreference = 'Stop'

function Get-SddRoot {
  if ($env:SDD_ROOT) { return $env:SDD_ROOT }
  $cwd = Get-Location
  $candidate = Join-Path $cwd 'project_sdd'
  return $candidate
}

function Test-IsSddTree($root) {
  (Test-Path (Join-Path $root '01-context')) -and (Test-Path (Join-Path $root '02-specs')) -and (Test-Path (Join-Path $root '03-decisions'))
}

function templatesRoot {
  # scaffold.ps1 vive em skills/, templates em skills/templates
  $here = Split-Path -Parent $MyInvocation.ScriptName
  return Join-Path $here 'templates'
}

function Copy-ContextTemplates($root) {
  $src = Join-Path $PSScriptRoot '..\templates\01-context'
  if (-not (Test-Path $src)) { $src = Join-Path $PSScriptRoot 'templates\01-context' }
  $dst = Join-Path $root '01-context'
  foreach ($f in 'README.md', 'project-map.md', 'product-vision.md', 'constraints.md', 'ARCHITECTURE_OVERVIEW.md', 'api-context.md') {
    $s = Join-Path $src $f
    if (Test-Path $s) { Copy-Item -LiteralPath $s -Destination $dst -Force }
  }
}

function Copy-SpecTemplate($specDir) {
  $src = Join-Path $PSScriptRoot '..\templates\02-specs\spec-template.md'
  if (-not (Test-Path $src)) { $src = Join-Path $PSScriptRoot 'templates\02-specs\spec-template.md' }
  if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $specDir 'spec.md') -Force }
}

function Write-StatusFile($root) {
  $specs = Get-ChildItem -LiteralPath (Join-Path $root '02-specs') -Directory -ErrorAction SilentlyContinue | Sort-Object Name
  # KPIs no topo (checkpoint de sessao <300 tokens)
  $open = 0; $blocked = 0; $done = 0
  foreach ($d in $specs) {
    $specPath = Join-Path $d.FullName 'spec.md'
    if (Test-Path $specPath) {
      $content = Get-Content -LiteralPath $specPath -Raw -ErrorAction SilentlyContinue
      $verdict = '?'
      if ($content -match 'verdict:\s*([^\s\r\n|]+)') { $verdict = $Matches[1] }
      switch ($verdict) { 'ready' { $done++ } 'blocked' { $blocked++ } default { $open++ } }
    } else { $open++ }
  }
  $adrCount = 0
  $adrDir = Join-Path $root '03-decisions'
  if (Test-Path $adrDir) {
    $adrCount = @(Get-ChildItem -LiteralPath $adrDir -Filter 'ADR-*.md' -File -ErrorAction SilentlyContinue).Count
  }
  $lines = @()
  $lines += '# STATUS.md'
  $lines += ''
  $lines += '## KPIs'
  $lines += ''
  $lines += "- trilhas: $open abertas | $blocked bloqueadas | $done prontas (total: $($specs.Count))"
  $lines += "- ADRs: $adrCount"
  $lines += "- updated: $(Get-Date -Format 'yyyy-MM-dd')"
  $lines += ''
  $lines += '## Trilhas'
  $lines += ''
  $lines += '| NNN | slug | tipo | verdict | updated |'
  $lines += '| --- | ---- | ---- | ------- | ------- |'
  foreach ($d in $specs) {
    $nnn = $d.Name.Split('-')[0]
    $slug = $d.Name.Substring($d.Name.IndexOf('-') + 1)
    $tipo = '?'
    $verdict = '?'
    $updated = (Get-Item $d.FullName).LastWriteTime.ToString('yyyy-MM-dd')
    $specPath = Join-Path $d.FullName 'spec.md'
    if (Test-Path $specPath) {
      $content = Get-Content -LiteralPath $specPath -Raw -ErrorAction SilentlyContinue
      if ($content -match '\*\*Variante:\*\*\s*([^\s\r\n|]+)') { $tipo = $Matches[1] }
      if ($content -match 'verdict:\s*([^\s\r\n|]+)') { $verdict = $Matches[1] }
    }
    $lines += "| $nnn | $slug | $tipo | $verdict | $updated |"
  }
  Set-Content -LiteralPath (Join-Path $root 'STATUS.md') -Value ($lines -join "`r`n") -Encoding utf8
}

function Invoke-Init($root) {
  if (Test-Path $root) { Write-Host "raiz ja existe: $root" } else { New-Item -ItemType Directory -Path $root | Out-Null }
  foreach ($d in '01-context', '02-specs', '03-decisions') {
    $p = Join-Path $root $d
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
  }
  # subpastas de entrada (telas vision + prototipo) — mantidas com .gitkeep
  foreach ($d in @('01-context\screens', '01-context\prototype\designs', '01-context\prototype\review')) {
    $p = Join-Path $root $d
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
    $keep = Join-Path $p '.gitkeep'
    if (-not (Test-Path $keep)) { New-Item -ItemType File -Path $keep | Out-Null }
  }
  Copy-ContextTemplates $root
  Write-StatusFile $root
  Write-Host "init ok -> $root (STATUS.md + 01-context/ templates + 02-specs/ + 03-decisions/ + screens/ + prototype/)"
}

function Invoke-New {
  # aridade: (tipo, slug) 2 args, ou (tipo, NNN, slug) 3 args
  $tipo = $args[0]
  $nnn = $null
  $slug = $null
  if ($args.Count -eq 2) { $slug = $args[1] }
  elseif ($args.Count -ge 3) { $nnn = $args[1]; $slug = $args[2] }
  if (-not $tipo) { throw "tipo ausente: feature | bug-fix | investigation | doc-update" }
  if (-not $slug) { throw "slug ausente (kebab-case)" }
  $root = Get-SddRoot
  if (-not (Test-IsSddTree $root)) { throw "arvore SDD nao existe em $root. rode: scaffold.ps1 init <root>" }
  if (-not $nnn) {
    $existing = Get-ChildItem -LiteralPath (Join-Path $root '02-specs') -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { [int]($_.Name.Split('-')[0]) } | Sort-Object -Descending | Select-Object -First 1
    $nnn = if ($existing) { ('{0:000}' -f ($existing + 1)) } else { '001' }
  }
  $dirName = "$nnn-$slug"
  $specDir = Join-Path (Join-Path $root '02-specs') $dirName
  if (-not (Test-Path $specDir)) { New-Item -ItemType Directory -Path $specDir | Out-Null }
  Copy-SpecTemplate $specDir
  # anota variante + slug + NNN em todo o template
  $specPath = Join-Path $specDir 'spec.md'
  $c = Get-Content -LiteralPath $specPath -Raw
  $c = $c -replace '(\*\*Variante:\*\*)[^\r\n]*', "**Variante:** $tipo"
  $c = $c -replace '(\*\*Slug:\*\*)[^\r\n]*', "**Slug:** $slug"
  $c = $c -replace '\{NNN\}', $nnn
  $c = $c -replace '\{slug\}', $slug
  Set-Content -LiteralPath $specPath -Value $c -Encoding utf8 -NoNewline
  Write-StatusFile $root
  Write-Host "new ok -> 02-specs/$dirName/spec.md"
}

function Invoke-Harvest($raiz) {
  if (-not $raiz) { $raiz = (Get-Location).Path }
  $root = Get-SddRoot
  $mds = Get-ChildItem -LiteralPath $raiz -Recurse -Filter '*.md' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|project_sdd|\.sdd|ia-framework)\\' }
  foreach ($f in $mds) {
    Write-Host "---- $($f.FullName.Replace($raiz, '').TrimStart('\')) ----"
    $lines = Get-Content -LiteralPath $f.FullName -ErrorAction SilentlyContinue
    # front-matter (primeiro bloco --- ... ---)
    if ($lines.Count -ge 1 -and $lines[0] -match '^\s*---\s*$') {
      for ($i = 1; $i -lt $lines.Count -and $lines[$i] -notmatch '^\s*---\s*$'; $i++) { Write-Host "  $($_)" }
    }
    # outline (até 10 cabeçalhos)
    $h = 0
    foreach ($line in $lines) {
      if ($line -match '^##\s+') { Write-Host "  $line"; $h++; if ($h -ge 10) { break } }
    }
  }
}

function Invoke-Context($refs) {
  foreach ($r in $refs) {
    $parts = $r -split ':'
    $file = $parts[0]
    $line = if ($parts.Length -gt 1) { [int]$parts[1] } else { 1 }
    $pad = 5
    $start = [Math]::Max(1, $line - $pad)
    $end = $line + $pad
    Write-Host "---- $r ----"
    if (Test-Path $file) {
      Get-Content -LiteralPath $file | Select-Object -Skip ($start - 1) -First ($end - $start + 1) |
        ForEach-Object { Write-Host "  $_" }
    } else {
      Write-Host "  (arquivo nao encontrado)"
    }
  }
}

function Invoke-Index($write) {
  $root = Get-SddRoot
  if ($write) { Write-StatusFile $root; Write-Host "index --write ok" }
  else { Write-Host "(dry-run) refaria STATUS.md em $root. Use: scaffold.ps1 index --write" }
}

function Invoke-Migrate($write) {
  $root = Get-SddRoot
  Write-Host "migrate:-layout antigo (9 dirs) -> enxuto em $root"
  if (-not $write) { Write-Host "(dry-run) --write para aplicar"; return }
  $map = @{
    '03-specs'      = '02-specs'
    '07-decisions'  = '03-decisions'
  }
  foreach ($k in $map.Keys) {
    $src = Join-Path $root $k
    $dst = Join-Path $root $map[$k]
    if (Test-Path $src) {
      if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst | Out-Null }
      $taken = Get-ChildItem -LiteralPath $dst -ErrorAction SilentlyContinue
      if ($taken) { Write-Host "PULADO $k -> $($map[$k]) (destino ocupado)" }
      else {
        Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
        $legado = Join-Path $root '_legado'
        if (-not (Test-Path $legado)) { New-Item -ItemType Directory -Path $legado | Out-Null }
        Move-Item -LiteralPath $src -Destination $legado -Force
        Write-Host "OK $k -> $($map[$k]) (origem em _legado/)"
      }
    }
  }
  foreach ($k in '02-discovery', '04-prompts', '05-tasks', '06-validation', '08-handoffs') {
    $src = Join-Path $root $k
    if (Test-Path $src) {
      $legado = Join-Path $root '_legado'
      if (-not (Test-Path $legado)) { New-Item -ItemType Directory -Path $legado | Out-Null }
      Move-Item -LiteralPath $src -Destination $legado -Force
      Write-Host "OK $k -> _legado/"
    }
  }
  $oldStatus = Join-Path (Join-Path $root '00-meta') 'STATUS.md'
  if (Test-Path $oldStatus) { Move-Item -LiteralPath $oldStatus -Destination (Join-Path $root 'STATUS.md') -Force; Write-Host "OK 00-meta/STATUS.md -> STATUS.md" }
  Write-StatusFile $root
  Write-Host "migrate --write ok"
}

# ---- dispatch ----
if (-not $Args -or $Args.Count -eq 0) {
  Write-Host "Uso: scaffold.ps1 <init|new|harvest|context|index|migrate> [args...]"
  exit 0
}
$cmd = $Args[0]
$rest = if ($Args.Count -gt 1) { $Args[1..($Args.Count - 1)] } else { @() }
switch ($cmd) {
  'init'    { Invoke-Init @($rest | Select-Object -First 1) }
  'new'     { Invoke-New @rest }
  'harvest' { Invoke-Harvest @($rest | Select-Object -First 1) }
  'context' { Invoke-Context @rest }
  'index'   { Invoke-Index ($Args -contains '--write') }
  'migrate' { Invoke-Migrate ($Args -contains '--write') }
  default   { Write-Host "comando desconhecido: $cmd"; exit 2 }
}