---
name: screens
description: Ingestão de telas visuais (.png/.jpg/.fig/.xd) via LLM vision anexado ao prompt — descreve layout, componentes, paths de interação, estados loading/erro/vazio, a11y esperada. Gera `01-context/screens/<id>.md` estruturado em template. Não decide arquitetura — só captura e estrutura. Sdd-planner referencia IDs de telas no comportamento alvo das trilhas Angular.
---

# Telas — Ingestão via LLM vision

Converte artefatos visuais (`.png`/`.jpg`/`.fig`/`.xd`) em descrições estruturadas que
alimentam specs SDD — especialmente Angular. Reduz alucinações de layout/a11y sem obrigar
a desenhar specs de UI no escuro.

## Pipeline

```
req/screens/*.png  ──▶  /load-screens req/screens/
                       │
                       ├─ Anexe as imagens ao prompt (LLM vision)
                       ├─ screens-reader descreve em template
                       └─ 01-context/screens/<id>.md (1 por tela)
```

Na geração de trilha: `sdd-planner` referencia IDs de telas no "Comportamento alvo" da
spec Angular (ex.: "Tela `S-03`: lista orders com skeletons + estado vazio").

## Princípios

1. **Vision via LLM anexado ao prompt** — não há script local de OCR/vision. O usuário
   anexa PNG no prompt que invoca `/load-screens`; o LLM vision descreve.
2. **Template canônico** — toda tela vira `01-context/screens/<id>.md` com seções
   obrigatórias (posição/layout, componentes, paths, estados, a11y, fluxo).
3. **IDs estáveis** — `S-001`...`S-NNN`; preservados entre atualizações. Reingestão
   atualiza descrição, mantém ID (mesma técnica dos `RF-12` do requirements).
4. **Sem código de produção** — só descrição estruturada. Implementador Angular converte
   descrição em componente em fase 3 do SDD.
5. **Não substitui大姐de design** — descrição captura layout, não design system. Tokens
   de cor/tipografia vivem em outras fontes.

## Quando usar

- Há `.png`/`.fig`/`.xd` em `req/screens/` que precisa virar spec Angular.
- O usuário carrega mockups do Figma/Adobe/Sketch exportados.
- Documento `.docx` menciona "ver tela X" sem descrevê-la.

## Quando NÃO usar

- Sem telas visuais relevantes (feature só backend) — skip.
- Telas já estão em produção e você só vai descrever mudanças — descreva diff no
  template via `sdd-feature`.

## Limitação declarada

- Não há script local de OCR/vision — depende do LLM vision disponível no ambiente do
  orquestrador. Se o ambiente não anexou imagens ao prompt, o command falha gracioso
  pedindo anexo binário (não path absoluto).

## Setup

Nada a instalar no repo. `01-context/screens/` é criado pelo `init.ps1`/`init.sh`.