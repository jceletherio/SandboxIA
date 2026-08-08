#!/usr/bin/env pwsh
# Runs Prisma commands inside Docker with host networking.
# Docker Desktop on Windows doesn't properly forward scram-sha-256
# authentication through port mapping. This script works around that
# by running Prisma inside a container that can access the host network.
#
# Usage:
#   .\prisma-docker.ps1 migrate dev --name my_migration
#   .\prisma-docker.ps1 db push
#   .\prisma-docker.ps1 generate
#   .\prisma-docker.ps1 studio

param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PrismaArgs
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $PSScriptRoot

$dockerArgs = @(
  'run', '--rm', '--network', 'host',
  '-v', "${PSScriptRoot}:/app",
  '-w', '/app',
  '-e', 'DATABASE_URL=postgresql://sandboxia:sandboxia@127.0.0.1:5432/sandboxia?sslmode=disable',
  'node:22-alpine',
  'npx', 'prisma'
)

if ($PrismaArgs) {
  $dockerArgs += $PrismaArgs
} else {
  $dockerArgs += @('db', 'push')
}

Write-Host "docker $($dockerArgs -join ' ')" -ForegroundColor DarkGray
& docker $dockerArgs