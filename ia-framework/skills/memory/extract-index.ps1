<#
.SYNOPSIS
  Gera project_sdd/INDEX.md - indice curado (~500 tokens) das memorias do projeto.
  Varre 01-context/, 02-specs/, 03-decisions/, docs/architecture/, docs/testing/ e
  sintetiza path + titulo + heads de secao. Idempotente (exceto `updated:`).

  Uso:
    pwsh -File extract-index.ps1 <SDD_ROOT>
    powershell -NoProfile -ExecutionPolicy Bypass -File extract-index.ps1 <SDD_ROOT>
#>

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$SddRoot
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SddRoot)) {
  [Console]::Error.WriteLine("SDD_ROOT nao existe: $SddRoot")
  exit 2
}

$projectRoot = (Resolve-Path -LiteralPath $SddRoot).Path
$docsRoot = Join-Path (Split-Path -Parent $projectRoot) 'docs'

$lines = New-Object System.Collections.Generic.List[string]
function Add-Line($text) { $script:lines.Add($text) }

Add-Line '---'
Add-Line 'title: Indice de memoria do projeto'
Add-Line ("updated: " + (Get-Date -Format 'yyyy-MM-dd'))
Add-Line 'kpis: { health: green }'
Add-Line '---'
Add-Line ''
Add-Line '# Indice de memoria (<500 tokens)'
Add-Line ''
Add-Line '> Gerado por `extract-index.ps1`. Cache, nao source of truth. Consulte antes'
Add-Line '> de mergulhar em arquivos. Desatualizado? Use `grep -rn` ou dispare'
Add-Line '> `context-curator` em modo update.'
Add-Line ''
Add-Line '## KPIs'
Add-Line ''

$specsDir = Join-Path $projectRoot '02-specs'
$adrsDir  = Join-Path $projectRoot '03-decisions'
$specs = @()
if (Test-Path -LiteralPath $specsDir) {
  $specs = @(Get-ChildItem -LiteralPath $specsDir -Directory -ErrorAction SilentlyContinue)
}
$adrs = @()
if (Test-Path -LiteralPath $adrsDir) {
  $adrs = @(Get-ChildItem -LiteralPath $adrsDir -Filter 'ADR-*.md' -File -ErrorAction SilentlyContinue)
}

$open = 0; $blocked = 0; $done = 0
foreach ($s in $specs) {
  $specPath = Join-Path $s.FullName 'spec.md'
  if (-not (Test-Path -LiteralPath $specPath)) { $open++; continue }
  $c = Get-Content -LiteralPath $specPath -Raw -ErrorAction SilentlyContinue
  if ($c -match 'verdict:\s*([^\s\r\n|]+)') {
    switch ($Matches[1]) { 'ready' { $done++ } 'blocked' { $blocked++ } default { $open++ } }
  } else { $open++ }
}
Add-Line ("- trilhas: $open abertas | $blocked bloqueadas | $done prontas (total: " + $specs.Count + ")")
Add-Line ("- ADRs propostos: " + $adrs.Count)
Add-Line ''
Add-Line '## Mapa'
Add-Line ''

function Add-Section($label, $paths) {
  if (-not $paths -or $paths.Count -eq 0) { return }
  $script:lines.Add("### $label") | Out-Null
  $script:lines.Add('') | Out-Null
  foreach ($p in $paths) {
    if (-not $p) { continue }
    $rel = $p
    if ($p.StartsWith($projectRoot)) {
      $rel = 'project_sdd' + ($p.Substring($projectRoot.Length)).Replace('\','/')
    } else {
      $parent = Split-Path -Parent $projectRoot
      if ($p.StartsWith($parent)) {
        $rel = $p.Substring($parent.Length).TrimStart('\','/').Replace('\','/')
      }
    }
    $title = ''; $heads = @()
    if (Test-Path -LiteralPath $p) {
      $fileLines = Get-Content -LiteralPath $p -ErrorAction SilentlyContinue | Select-Object -First 80
      foreach ($fl in $fileLines) {
        if ($fl -match '^#\s+(.+)$' -and -not $title) { $title = $Matches[1]; continue }
        if ($fl -match '^##\s+(.+)$') { $heads += $Matches[1] }
      }
    }
    $h = ($heads | Select-Object -First 8) -join ' - '
    $script:lines.Add("- ``$rel`` - $title") | Out-Null
    if ($h) { $script:lines.Add("  - secoes: $h") | Out-Null }
  }
  $script:lines.Add('') | Out-Null
}

$ctxFiles = @()
$ctxDir = Join-Path $projectRoot '01-context'
if (Test-Path -LiteralPath $ctxDir) {
  $ctxFiles = @(Get-ChildItem -LiteralPath $ctxDir -Filter '*.md' -File -ErrorAction SilentlyContinue)
}
Add-Section '01-context (memoria viva)' $ctxFiles.FullName

$specFiles = @()
foreach ($s in $specs) {
  $sp = Join-Path $s.FullName 'spec.md'
  if (Test-Path -LiteralPath $sp) { $specFiles += $sp }
}
Add-Section '02-specs (trilhas SDD)' $specFiles

Add-Section '03-decisions (ADRs)' $adrs.FullName

$archFiles = @()
$archDir = Join-Path $docsRoot 'architecture'
if (Test-Path -LiteralPath $archDir) {
  $archFiles = @(Get-ChildItem -LiteralPath $archDir -Filter '*.md' -File -ErrorAction SilentlyContinue)
}
Add-Section 'docs/architecture (snapshot per-release)' $archFiles.FullName

$testFiles = @()
$testDir = Join-Path $docsRoot 'testing'
if (Test-Path -LiteralPath $testDir) {
  $testFiles = @(Get-ChildItem -LiteralPath $testDir -Filter '*.md' -File -ErrorAction SilentlyContinue)
}
Add-Section 'docs/testing (planos de teste)' $testFiles.FullName

Add-Line '## Nao cobre'
Add-Line ''
Add-Line '- Codigo de producao - use `grep -rn` em `src/frontend/`, `src/backend/`, `src/BD/`.'
Add-Line '- Estado de git - use `git status`/`git log`.'

$out = Join-Path $projectRoot 'INDEX.md'
$content = ($lines -join "`r`n")
Set-Content -LiteralPath $out -Value $content -Encoding utf8
Write-Host ("INDEX.md gerado: " + $out + " (" + $lines.Count + " linhas)")