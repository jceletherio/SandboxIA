#!/usr/bin/env bash
# Gera project_sdd/INDEX.md — índice curado (~500 tokens) das memórias do projeto.
# Varre 01-context/, 02-specs/, 03-decisions/, docs/architecture/, docs/testing/.
# Idempotente (exceto `updated:`).
set -euo pipefail

sdd_root="${1:-}"
[[ -n "$sdd_root" ]] || { echo "uso: extract-index.sh <SDD_ROOT>"; exit 2; }
sdd_root="$(cd "$sdd_root" && pwd)"
[[ -d "$sdd_root" ]] || { echo "SDD_ROOT nao existe: $sdd_root" >&2; exit 2; }

docs_root="$(cd "$sdd_root/.." && pwd)/docs"

{
  echo '---'
  echo 'title: Índice de memória do projeto'
  echo "updated: $(date +%Y-%m-%d)"
  echo 'kpis: { health: green }'
  echo '---'
  echo ''
  echo '# Índice de memória (<500 tokens)'
  echo ''
  echo '> Gerado por `extract-index.sh`. Cache, não source of truth. Consulte antes'
  echo '> de mergulhar em arquivos. Desatualizado? Use `grep -rn` ou dispare'
  echo '> `context-curator` em modo update.'
  echo ''
  echo '## KPIs'
  echo ''

  # KPIs
  open=0; blocked=0; done=0; total=0; adrs=0
  if [[ -d "$sdd_root/02-specs" ]]; then
    for d in "$sdd_root"/02-specs/*; do
      [[ -d "$d" ]] || continue
      total=$((total + 1))
      if [[ -f "$d/spec.md" ]]; then
        verdict=$(grep -m1 -E 'verdict:\s*[A-Za-z0-9_-]+' "$d/spec.md" | sed -E 's/.*verdict:\s*//' || true)
        case "$verdict" in
          ready)    done=$((done + 1)) ;;
          blocked)  blocked=$((blocked + 1)) ;;
          *)        open=$((open + 1)) ;;
        esac
      else
        open=$((open + 1))
      fi
    done
  fi
  if [[ -d "$sdd_root/03-decisions" ]]; then
    adrs=$(ls -1 "$sdd_root"/03-decisions/ADR-*.md 2>/dev/null | wc -l || echo 0)
  fi
  echo "- trilhas: $open abertas | $blocked bloqueadas | $done prontas (total: $total)"
  echo "- ADRs propostos: $adrs"

  echo ''
  echo '## Mapa'
  echo ''

  emit() {
    local label="$1"; shift
    local files=("$@")
    [[ ${#files[@]} -gt 0 ]] || return 0
    echo "### $label"
    echo ''
    for f in "${files[@]}"; do
      local rel
      case "$f" in
        "$sdd_root"/*) rel="project_sdd/${f#$sdd_root/}" ;;
        *) rel="${f#$(cd "$sdd_root/.." && pwd)/}" ;;
      esac
      local title=''; local heads=''
      if [[ -f "$f" ]]; then
        title=$(grep -m1 -E '^#\s+' "$f" | sed -E 's/^#\s+//' || true)
        heads=$(grep -m8 -E '^##\s+' "$f" | sed -E 's/^##\s+//' | tr '\n' '|' | sed 's/|$//' | tr '|' '·')
      fi
      echo "- \`$rel\` — $title"
      [[ -n "$heads" ]] && echo "  - seções: $heads"
    done
    echo ''
  }

  # 01-context
  ctx=()
  [[ -d "$sdd_root/01-context" ]] && while IFS= read -r -d '' f; do ctx+=("$f"); done < <(find "$sdd_root/01-context" -maxdepth 1 -type f -name '*.md' -print0 2>/dev/null)
  emit '01-context (memória viva)' "${ctx[@]}"

  # 02-specs
  specs=()
  if [[ -d "$sdd_root/02-specs" ]]; then
    for d in "$sdd_root"/02-specs/*; do
      [[ -d "$d" ]] || continue
      [[ -f "$d/spec.md" ]] && specs+=("$d/spec.md")
    done
  fi
  emit '02-specs (trilhas SDD)' "${specs[@]}"

  # 03-decisions
  adrs_files=()
  if [[ -d "$sdd_root/03-decisions" ]]; then
    while IFS= read -r -d '' f; do adrs_files+=("$f"); done < <(find "$sdd_root/03-decisions" -maxdepth 1 -type f -name 'ADR-*.md' -print0 2>/dev/null)
  fi
  emit '03-decisions (ADRs)' "${adrs_files[@]}"

  # docs/architecture
  arch_files=()
  [[ -d "$docs_root/architecture" ]] && while IFS= read -r -d '' f; do arch_files+=("$f"); done < <(find "$docs_root/architecture" -maxdepth 1 -type f -name '*.md' -print0 2>/dev/null)
  emit 'docs/architecture (snapshot per-release)' "${arch_files[@]}"

  # docs/testing
  test_files=()
  [[ -d "$docs_root/testing" ]] && while IFS= read -r -d '' f; do test_files+=("$f"); done < <(find "$docs_root/testing" -maxdepth 1 -type f -name '*.md' -print0 2>/dev/null)
  emit 'docs/testing (planos de teste)' "${test_files[@]}"

  echo '## Não cobre'
  echo ''
  echo '- Código de produção — use `grep -rn` em `frontend/`, `backend/`, `BD/`.'
  echo '- Estado de git — use `git status`/`git log`.'
} > "$sdd_root/INDEX.md"

echo "INDEX.md gerado: $sdd_root/INDEX.md ($(wc -l < "$sdd_root/INDEX.md") linhas)"