---
description: Carrega telas visuais (.png/.jpg) de um diretório (default `req/screens/`) usando LLM vision anexado ao prompt atual e gera `01-context/screens/<id>.md` estruturado. IDs estáveis (S-NNN) para referência entre specs SDD. Delega a `screens-reader`. Reque anexo binário no prompt.
args: [<dir>]
---

Ingesta telas via LLM vision.

## Quando usar

- Há `.png`/`.jpg`/`.fig`/`.xd` em `req/screens/` que precisa virar spec Angular.
- Documento de requisitos `.docx` remete à tela X sem descrevê-la.
- Antes de `/plan-from-requirements` quando o requisito cita telas visuais.

## Quando NÃO usar

- Sem telas relevantes (feature só backend) — skip silent.
- Telas já estão descritas e `01-context/screens/S-NNN-*.md` bate com imagens novas —
  reingestão é opcional; dobre o ID antes de pular.

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado e `project_sdd/01-context/` existe. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara.
>
> Extra: se `req/screens/` ausente ou vazio, sugira `/req-add <imagem-png>` chained
> para copiar antes de processar.

## Condução

1. `$ARGUMENTS` traz `<dir>` (default `req/screens/`). Confirme diretório existe:
   ```
   Get-ChildItem -LiteralPath <dir> -Recurse -Include *.png,*.jpg
   # ou em Bash: find <dir> -type f \( -name '*.png' -o -name '*.jpg' \)
   ```
2. **Anexe as imagens no prompt atual** — esse é o ponto crítico:
   - Em ambientes com vision (LLM grande multimodal), o usuário/CLI envia PNG embedded
     no prompt; o LLM vision descreve em template.
   - Sem anexo binário → pare e reporte: "Não recebi anexo binário. Cole cada `.png`
     no chat para prosseguir, ou use `requirements-reader` para descrever telas em
     texto se a visão não está disponível."
3. Garanta `project_sdd/01-context/screens/` existe (criando do `init.ps1`).
4. Delegue ao agente `screens-reader`:
   - Atribui IDs `S-001`, `S-002`, ... (incremental; reuse em reingestão com mesmo
     `source`).
   - Descreve cada imagem no template `skills/screens/templates/screen-template.md`.
   - Persiste em `01-context/screens/S-NNN-<slug>.md`.
   - Devolve recibo: lista de IDs + lacunas.
5. Apresente recibo ao usuário:
   - Telas carregadas (IDs + paths relativos).
   - Lacunas marcadas que virarão perguntas ao `sdd-planner` (itens `[AMBIGUO]`).
6. **Sugira próximo passo**: `/plan-from-requirements <file>` — o `sdd-planner` vai
   referenciar os `S-NNN` no comportamento alvo das trilhas Angular.

## Fallback gracioso

- Se o usuário não consegue anexar imagens (CLI sem vision), troque para o caminho B
  alternativo: peça descrição textual livre no chat e use o `requirements-reader` para
  estruturar (a descrição textual vira parte de `requirements.md` em uma seção "Telas"
  ao invés de `01-context/screens/`).

## Limitação

- Não há script local de OCR/vision — depende do LLM vision embedado ao prompt atual.
- Arquivos `.fig`/`.xd` não são lidos diretamente: peça export PNG.
- Alta densidade textual pequena pode resultar em `[AMBIGUO]` — capture presença,
  detalhe humano adiciona depois.

## Não faça

- Não abra spec/trilha — isso é `sdd-planner`.
- Não decida arquitetura nem implemente Angular.
- Não invente IDs arbitrarios (sem `S-NNN` sequencial).