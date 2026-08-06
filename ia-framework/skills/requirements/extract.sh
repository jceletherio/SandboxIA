#!/usr/bin/env bash
# Extrai texto puro de requisitos em .md/.txt/.docx/.pdf para stdout.
# Sem dependências além de: unzip (.docx) e pdftotext (.pdf — instalável, detectado).
set -euo pipefail

file="${1:-}"
[[ -n "$file" ]] || { echo "uso: extract.sh <arquivo>"; exit 2; }
[[ -f "$file" ]] || { echo "arquivo nao encontrado: $file" >&2; exit 2; }

case "$(printf '%s' "$file" | tr '[:upper:]' '[:lower:]')" in
  *.md|*.txt)
    cat "$file"
    ;;
  *.docx)
    # OpenXML: documento em word/document.xml; extraímos via unzip (presente em quase todo POSIX)
    if ! command -v unzip >/dev/null 2>&1; then
      echo "unzip ausente. Instale: apt install unzip / brew install unzip / choco install unzip" >&2
      exit 4
    fi
    xml=$(unzip -p "$file" word/document.xml 2>/dev/null) || {
      echo "falha abrindo word/document.xml no docx" >&2; exit 3;
    }
    # w:p vira nova linha; w:tab == \t; w:br == \n; <w:t>...</w:t> texto preservado; resto stripped
    printf '%s' "$xml" \
      | sed -E 's/<w:p[ >]/\n<w:p>/g' \
      | sed -E 's/<w:tab\b[^>]*\/>/\t/g' \
      | sed -E 's/<w:br\b[^>]*\/>/\n/g' \
      | sed -E 's/<w:t([^>]*)>([^<]*)<\/w:t>/\2/g' \
      | sed -E 's/<[^>]+>//g' \
      | sed -E 's/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&apos;/'"'"'/g' \
      | sed -E 's/&#x([0-9A-Fa-f]+);/printf "\\x\1"/' \
      | sed -E '/^[[:space:]]*$/d'
    # Nota: o sed para &#x... usa printf via shell subst dentro do | sed -E com /e — não suportado em BSD sed.
    # Fallback mais simples: se surgirem entities numéricas, agente requirements-reader decodifica ao reler.
    ;;
  *.pdf)
    if ! command -v pdftotext >/dev/null 2>&1; then
      echo "pdftotext (poppler) ausente. Instale via:" >&2
      echo "  Debian/Ubuntu/WSL: apt install poppler-utils" >&2
      echo "  macOS:             brew install poppler" >&2
      echo "  Windows:          choco install poppler  ou  winget install oschwartz12612.Poppler" >&2
      exit 4
    fi
    pdftotext -layout "$file" -
    ;;
  *)
    echo "extensao nao suportada: ${file##*.} (use .md/.txt/.docx/.pdf)" >&2
    exit 6
    ;;
esac