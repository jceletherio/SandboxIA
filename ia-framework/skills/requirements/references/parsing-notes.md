# Parsing notes — lidando com o mundo real

Documentos de requisitos do mundo real são mal formatados, incompletos e contraditórios.
Este arquivo guia o `requirements-reader` na normalização sem perda.

## Fontes comuns de ruído

### Word (.docx)

- **Tabelas**: `extract` concatena células em linhas. Tabela de|RF|Descrição| vira
  três colunas por linha no texto puro. Detecte pelo padrão `RF-ID\s+descrição\s+...` e
  reconstrua a propriedade como tabela markdown.
- **Listas numeradas**: viram linhas começando com `1.`, `2.`, ... ou marcadores
  `•`. Preserve a numeração original.
- **Comments/Track Changes**: ignorados pelo `extract` (somente `<w:t>` do main
  document). Quando críticos, peça ao usuário que aceite as alterações e reingeste.
- **Headers/footers**: ignorados. Page numbers no `§` referem-se à posição visual
  aproximada do fluxo principal — não conferem com páginas físicas.

### PDF

- **Multi-column layouts**: `pdftotext -layout` preserva colunas mas pode misturá-las em
  tabelas pequenas. Detecte quando uma linha começa com text de uma coluna e termina com
  outra.
- **Headers de capítulo**: `1. Introdução` vira uma linha com break. Use como seções
  `§1`, `§2`, etc.
- **Notas de rodapé**: aparecem no fim da página; costuma virar uma run-on sentence
  entre páginas. Mantenha como bullet isolado em `Lacunas`.
- **OCR vs native**: se `pdftotext` devolve vazio mas o arquivo tem tamanho > 10KB, é
  imagem. Reporte e pare — recomende `ocrmypdf input.pdf output.pdf && reingest`.

### Markdown / TXT

- Já é texto puro. Preservar headings como `§1`, `§1.1`.
- Listas numeradas já vem estruturadas. Manter IDs.

## Heurísticas de classificação

Como detectar cada seção sem over-engineering:

| Procurar por | Classificar como |
| ------------ | ---------------- |
| `Como ... quero ... para` | História de usuário |
| `deve`/`shall`/`must` + verbo | RF |
| RF-N, RNF-N, US-N | Preservar IDs como estão |
| `prioridade`, `alta/média/baixa`, `MoSCoW` | Campo prioridade da RF |
| `latência`, `throughput`, `RPS`, `p95` | RNF categoria `performance` |
| `LGPD`, `GDPR`, `PCI`, `HIPAA` | Restrição compliance |
| `premissa`, `assumir`, `considerando` | Premissas |
| `glossário`, `definições`, `termos` | Glossário |

## Conflitos e ambiguidades — etiquetas

Toda incerteza etiquetada e rastreada:

- `[AMBIGUO]` — trecho admite múltiplas interpretações razoáveis.
- `[CONFLITO]` — duas partes do documento se contradizem.
- `[AUSENTE]` — esperávamos esta informação (RF, RNF, AC) e não veio.
- `[INFERIDO]` —涎 assumimos mas não está explícito. Vira Premissa, não RF.

**Nunca** resolva o conflito no documento; liste em `Lacunas` para o usuário responder.

## Quando parar

- docs com mais de 200 RF/US: extraia só o escopo solicitado (se o usuário passou
  seção/escope) ou processe tudo e reporte tamanho. Não truncate silenciosamente.
- PDFs sem texto extraído (imagem): pare e reporte — não invente.
- Documento corrompido: reporte `health: red` e liste `erro` no front-matter.

## Idempotência

Reextrair o mesmo arquivo (mesmo `hash`) deve produzir o mesmo `requirements.md` byte-a-byte
(exceto `extracted:` que é timestamp). Diff limpo confirma idempotência. Use em CI para
detectar mudança não-intencional.