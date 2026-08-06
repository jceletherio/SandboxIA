---
name: requirements
description: Ingesta documentos de requisitos externos (.docx/.pdf/.md/.txt), normaliza em `01-context/requirements.md` seguindo template, e prepara para `/plan-from-requirements`. Tolerante a falhas de parsing — entrega o que conseguir extrair + lista de lacunas. Gatilhos: "ler requisitos", "extrair requisitos", "carregar .docx/.pdf", "/load-requirements", "/plan-from-requirements".
---

# Assunto — Ingestão de Documentos de Requisitos

Converte arquivos externos (`.docx`, `.pdf`, `.md`, `.txt`) num único arquivo
`01-context/requirements.md` estruturado, pronto para alimentar o `sdd-planner`.

## Pipeline

```
arquivo externo ──▶ extract.{ps1,sh} (texto puro)
                ──▶ requirements-reader (normalização em template)
                ──▶ 01-context/requirements.md
```

## Princípios

1. **Sophisticado o suficiente, não mais.** Extrair requisitos não é interpretação de
   negócio — é captura. Não invente regra que não está no texto; quando ambíguo, marque
   `[AMBIGUO]` no campo e liste em "lacunas".
2. **Sem dependência frágil.** `.md`/`.txt` lidos direto. `.docx` via OpenXML unzip puro
   (sem Office/COM). `.pdf` via `pdftotext` (poppler) detectado no PATH; ausente →
   mensagem graciosa com dica de instalação e fallback para leitura manual.
3. **Idempotente.** Reextrair o mesmo arquivo sobrescreve `requirements.md` — diff do
   usuário confirma deltas. Lacre de versão via front-matter `source:`, `extracted:`,
   `hash:`.
4. **Normalização sem perda.** Quando o fonte traz tabela numerada de RF, preservar IDs
   originais (`RF-12`, `US-007`) e citar a página/seção de onde veio. Referência é caminho
   relativo real (`requisito.docx §3.2`) e nunca identificador sintético inventado.
5. **Lacunas explicitadas.** Tudo que ficou inferido e precisa confirmação humana vira
   linha no campo `lacunas`. Sem isso, o `sdd-planner` vai adivinhar e propagar erro.

## Formato de saída — `01-context/requirements.md`

Template em `templates/requirements-extract.md`. Seções obrigatórias:

- Front-matter: `title`, `source` (caminho original), `extracted` (data), `hash` (SHA-256
  do arquivo fonte), `kpis: { health: green|yellow|red }`.
- Visão do produto (1 parágrafo + 3-5 bullets)
- Epics / Features (com IDs preservados do fonte)
- Histórias de usuário (US-ID,Como X, quero Y, para Z; critérios de aceite)
- Requisitos funcionais (RF-ID, descrição, prioridade)
- Requisitos não funcionais (RNF-ID, descrição, categoria: performance/segurança/...)
- Restrições (técnica, negócio, compliance)
- Premissas
- Lacunas encontradas (ambiguidades, conflitos, informações faltando)
- Glossário

## Limitações declaradas

- **PDFs escaneados** (imagem sem OCR) não são extraídos por `pdftotext`. Detecte via
  saida vazia e reporte — recomende rodar `ocrmypdf` antes de reingestar.
- **Tabelas complexas no .docx** são flattenned em linhas de texto; structure visual
  pode se perder. Reporte quando perceived e mantenha IDs numéricos.
- **Headers/footers** do .docx são ignorados (não trazem requisitos).

## Setup

Nada a instalar no repo. `extract.ps1` e `extract.sh` ficam em
`skills/requirements/`. Dependência externa só `pdftotext` (poppler) para PDF, detectada
em runtime.

### Instalar poppler

- Windows: `choco install poppler` ou `winget install oschwartz12612.Poppler`
- macOS: `brew install poppler`
- Linux/WSL: `apt install poppler-utils` (Debian/Ubuntu)