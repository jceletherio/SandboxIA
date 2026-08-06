<#
.SYNOPSIS
  Extrai texto puro de requisitos em .md/.txt/.docx/.pdf para stdout.
  Uso pelo agente requirements-reader ou direto:
    pwsh -File extract.ps1 <arquivo>
    powershell -NoProfile -ExecutionPolicy Bypass -File extract.ps1 <arquivo>
#>

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
  [Console]::Error.WriteLine("arquivo nao encontrado: $Path")
  exit 2
}
$Path = (Resolve-Path -LiteralPath $Path).Path
$ext = [IO.Path]::GetExtension($Path).ToLowerInvariant()

function Convert-DocxToText($file) {
  # OpenXML: documentos养护ão em word/document.xml dentro do zip
  # Lemos via System.IO.Compression (padrão .NET, sem dep Office/COM)
  Add-Type -AssemblyName 'System.IO.Compression.FileSystem' -ErrorAction Stop
  $zip = [IO.Compression.ZipFile]::OpenRead($file)
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' } | Select-Object -First 1
    if (-not $entry) {
      [Console]::Error.WriteLine("nao encontrei word/document.xml no docx")
      exit 3
    }
    $reader = New-Object IO.StreamReader($entry.Open())
    $xml = $reader.ReadToEnd()
    $reader.Close()
  }
  finally { $zip.Dispose() }

  # Strip tags XML, preservando texto em <w:t> e quebra de parágrafo em <w:p>
  # w:p vira "`n"; w:tab vira "`t"; br vira "`n"; tabs entre elementos
  $txt = $xml
  # markers de quebra
  $txt = $txt -replace '<w:p[ >]', "`n"
  $txt = $txt -replace '<w:tab\b[^>]*/>', "`t"
  $txt = $txt -replace '<w:br\b[^>]*/>', "`n"
  # strip tab/brace/body restante exceto <w:t>
  $txt = $txt -replace '(?s)<w:t(?:"[^"]*"|[^>]*)>(.*?)</w:t>', '$1'
  # remove qualquer <...> residual
  $txt = $txt -replace '(?s)<[^>]+>', ''
  # decode XML entities básicos
  $txt = $txt -replace '&amp;', '&'
  $txt = $txt -replace '&lt;', '<'
  $txt = $txt -replace '&gt;', '>'
  $txt = $txt -replace '&quot;', '"'
  $txt = $txt -replace '&apos;', "'"
  # decode XML entities numéricos (&#x..; e &#...;) via loop (PS 5.1 não suporta MatchEvaluator em -replace)
  while ($txt -match '(?s)(.*)&#x([0-9A-Fa-f]+);(.*)') {
    $code = [Convert]::ToInt32($Matches[2], 16)
    $txt = $Matches[1] + [char]$code + $Matches[3]
  }
  while ($txt -match '(?s)(.*)&#(\d+);(.*)') {
    $code = [Convert]::ToInt32($Matches[2], 10)
    $txt = $Matches[1] + [char]$code + $Matches[3]
  }
  # collapse whitespace exagerado em cada linha
  $lines = $txt -split "`n" | ForEach-Object { ($_ -replace "\t+", "`t") -replace "\s+$", "" }
  ($lines -join "`n") -replace "(?m)^\s*$`r?`n", ''
}

function Convert-PdfToText($file) {
  $cmd = Get-Command pdftotext -ErrorAction SilentlyContinue
  if (-not $cmd) {
    [Console]::Error.WriteLine("pdftotext (poppler) ausente. Instale via:")
    [Console]::Error.WriteLine("  Windows:  choco install poppler   ou   winget install oschwartz12612.Poppler")
    [Console]::Error.WriteLine("  macOS:    brew install poppler")
    [Console]::Error.WriteLine("  Linux:    apt install poppler-utils")
    exit 4
  }
  $tmp = [IO.Path]::GetTempFileName()
  try {
    & $cmd.Source -layout $file $tmp
    if (-not $?) { [Console]::Error.WriteLine("pdftotext falhou"); exit 5 }
    Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
  }
  finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}

switch ($ext) {
  '.md'   { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 }
  '.txt'  { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 }
  '.docx' { Convert-DocxToText $Path }
  '.pdf'  { Convert-PdfToText $Path }
  default { [Console]::Error.WriteLine("extensao nao suportada: $ext (use .md/.txt/.docx/.pdf)"); exit 6 }
}