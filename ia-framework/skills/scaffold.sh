#!/usr/bin/env bash
# Scaffold da árvore SDD Enxuto (multi-stack) — versão Bash portable.
# Mesma CLI do scaffold.ps1. Roda em WSL/Linux/macOS/CI.
set -euo pipefail

sdd_root() {
  if [[ -n "${SDD_ROOT:-}" ]]; then echo "$SDD_ROOT"; else echo "./project_sdd"; fi
}

isSddTree() {
  local r="$1"
  [[ -d "$r/01-context" && -d "$r/02-specs" && -d "$r/03-decisions" ]]
}

templatesDir() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -d "$here/templates" ]]; then echo "$here/templates"
  elif [[ -d "$here/../templates" ]]; then (cd "$here/.." && pwd)/templates
  else echo "."; fi
}

copyContextTemplates() {
  local root="$1"
  local src
  src="$(templatesDir)/01-context"
  [[ -d "$src" ]] || return 0
  for f in README.md project-map.md product-vision.md constraints.md ARCHITECTURE_OVERVIEW.md api-context.md; do
    [[ -f "$src/$f" ]] && cp -f "$src/$f" "$root/01-context/$f"
  done
}

copySpecTemplate() {
  local specDir="$1"
  local src
  src="$(templatesDir)/02-specs/spec-template.md"
  [[ -f "$src" ]] && cp -f "$src" "$specDir/spec.md"
}

writeStatus() {
  local root="$1"
  local f line nnn slug tipo verdict updated
  local open=0 blocked=0 done=0 total=0 adrs=0
  # primeira passada para KPIs
  if [[ -d "$root/02-specs" ]]; then
    for d in $(ls -1 "$root/02-specs" 2>/dev/null | sort); do
      total=$((total + 1))
      f="$root/02-specs/$d/spec.md"
      verdict='?'
      if [[ -f "$f" ]]; then
        verdict=$(grep -m1 -E 'verdict:\s*[A-Za-z0-9_-]+' "$f" | sed -E 's/.*verdict:\s*//' || true)
      fi
      case "$verdict" in
        ready)   done=$((done + 1)) ;;
        blocked) blocked=$((blocked + 1)) ;;
        *)       open=$((open + 1)) ;;
      esac
    done
  fi
  if [[ -d "$root/03-decisions" ]]; then
    adrs=$(ls -1 "$root"/03-decisions/ADR-*.md 2>/dev/null | wc -l || echo 0)
  fi
  {
    echo "# STATUS.md"
    echo ""
    echo "## KPIs"
    echo ""
    echo "- trilhas: $open abertas | $blocked bloqueadas | $done prontas (total: $total)"
    echo "- ADRs: $adrs"
    echo "- updated: $(date +%Y-%m-%d)"
    echo ""
    echo "## Trilhas"
    echo ""
    echo "| NNN | slug | tipo | verdict | updated |"
    echo "| --- | ---- | ---- | ------- | ------- |"
    if [[ -d "$root/02-specs" ]]; then
      for d in $(ls -1 "$root/02-specs" 2>/dev/null | sort); do
        nnn="${d%%-*}"
        slug="${d#*-}"
        tipo="?"; verdict="?"; updated="$(date +%Y-%m-%d)"
        f="$root/02-specs/$d/spec.md"
        if [[ -f "$f" ]]; then
          tipo=$(grep -m1 -E '\*\*Variante:\*\*\s*[A-Za-z0-9_-]+' "$f" | sed -E 's/.*\*\*Variante:\*\*\s*//' || true)
          verdict=$(grep -m1 -E 'verdict:\s*[A-Za-z0-9_-]+' "$f" | sed -E 's/.*verdict:\s*//' || true)
        fi
        echo "| $nnn | $slug | $tipo | $verdict | $updated |"
      done
    fi
  } > "$root/STATUS.md"
}

doInit() {
  local root="${1:-}"
  [[ -n "$root" ]] || { echo "uso: init <root>"; exit 2; }
  mkdir -p "$root/01-context" "$root/02-specs" "$root/03-decisions"
  # subpastas de entrada (telas vision + prototipo) — mantidas com .gitkeep
  mkdir -p "$root/01-context/screens" "$root/01-context/prototype/designs" "$root/01-context/prototype/review"
  touch "$root/01-context/screens/.gitkeep" \
        "$root/01-context/prototype/designs/.gitkeep" \
        "$root/01-context/prototype/review/.gitkeep"
  copyContextTemplates "$root"
  writeStatus "$root"
  echo "init ok -> $root"
}

doNew() {
  local tipo="${1:-}"; local nnn="${2:-}"; local slug="${3:-}"
  [[ -n "$tipo" && -n "$slug" ]] || { echo "uso: new <tipo> [NNN] <slug>"; exit 2; }
  local root; root="$(sdd_root)"
  isSddTree "$root" || { echo "arvore SDD nao existe em $root. rode: init <root>"; exit 3; }
  if [[ -z "$nnn" ]]; then
    local last
    last=$(ls -1 "$root/02-specs" 2>/dev/null | sort | tail -1 | cut -d- -f1 || true)
    if [[ -n "$last" ]]; then nnn=$(printf '%03d' "$((10#$last + 1))"); else nnn="001"; fi
  fi
  local dirName="$nnn-$slug"
  local specDir="$root/02-specs/$dirName"
  mkdir -p "$specDir"
  copySpecTemplate "$specDir"
  # anota variante/slug/NNN
  local f="$specDir/spec.md"
  sed -i -E "s/\*\*Variante:\*\*\s*\w+/**Variante:** $tipo/" "$f"
  sed -i -E "s/\*\*Slug:\*\*\s*\{slug\}/**Slug:** $slug/" "$f"
  sed -i "s/{NNN}/$nnn/g" "$f"
  writeStatus "$root"
  echo "new ok -> 02-specs/$dirName/spec.md"
}

doHarvest() {
  local raiz="${1:-$(pwd)}"
  local f first
  for f in $(find "$raiz" -type f -name '*.md' \
            -not -path '*/node_modules/*' -not -path '*/.git/*' \
            -not -path '*/project_sdd/*' -not -path '*/.sdd/*' \
            -not -path '*/ia-framework/*' 2>/dev/null); do
    echo "---- ${f#$raiz/} ----"
    awk '
      NR==1 && /^---$/ { infm=1; next }
      infm==1 { if (/^---$/) infm=2; else print "  "$0; next }
      /^## / { print "  "$0; h++; if (h>=10) exit }
    ' "$f"
  done
}

doContext() {
  local r file line start
  for r in "$@"; do
    file="${r%%:*}"
    line="${r##*:}"
    [[ "$file" == "$line" ]] && line=1
    start=$(( line - 5 )); (( start < 1 )) && start=1
    echo "---- $r ----"
    [[ -f "$file" ]] && sed -n "${start},$((line + 5))p" "$file" | sed 's/^/  /' || echo "  (arquivo nao encontrado)"
  done
}

doIndex() {
  local root; root="$(sdd_root)"
  if [[ "${1:-}" == "--write" ]]; then writeStatus "$root"; echo "index --write ok"
  else echo "(dry-run) refaria STATUS.md em $root"; fi
}

doMigrate() {
  local root; root="$(sdd_root)"
  echo "migrate:layout antigo (9 dirs) -> enxuto em $root"
  [[ "${1:-}" == "--write" ]] || { echo "(dry-run) --write para aplicar"; return; }
  local src dst
  for k in "03-specs:02-specs" "07-decisions:03-decisions"; do
    src="$root/${k%%:*}"; dst="$root/${k##*:}"
    if [[ -d "$src" ]]; then
      mkdir -p "$dst"
      if [[ -n "$(ls -A "$dst" 2>/dev/null)" ]]; then echo "PULADO ${k%%:*} -> ${k##*:} (ocupado)"
      else
        mkdir -p "$root/_legado"
        cp -rf "$src"/* "$dst"/ 2>/dev/null || true
        mv "$src" "$root/_legado/${k%%:*}"
        echo "OK ${k%%:*} -> ${k##*:}"
      fi
    fi
  done
  for k in 02-discovery 04-prompts 05-tasks 06-validation 08-handoffs; do
    [[ -d "$root/$k" ]] && { mkdir -p "$root/_legado"; mv "$root/$k" "$root/_legado/"; echo "OK $k -> _legado/"; }
  done
  if [[ -f "$root/00-meta/STATUS.md" ]]; then mv "$root/00-meta/STATUS.md" "$root/STATUS.md"; echo "OK 00-meta/STATUS.md -> STATUS.md"; fi
  writeStatus "$root"
  echo "migrate --write ok"
}

# ---- dispatch ----
cmd="${1:-}"; [[ -z "$cmd" ]] && { echo "Uso: scaffold.sh <init|new|harvest|context|index|migrate> [args...]"; exit 0; }
shift || true
case "$cmd" in
  init)    doInit "${1:-}" ;;
  new)     doNew "${1:-}" "${2:-}" "${3:-}" ;;
  harvest) doHarvest "${1:-}" ;;
  context) doContext "$@" ;;
  index)   doIndex "${1:-}" ;;
  migrate) doMigrate "${1:-}" ;;
  *)       echo "comando desconhecido: $cmd"; exit 2 ;;
esac