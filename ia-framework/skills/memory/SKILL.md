---
name: memory
description: Fornece índice curado (`project_sdd/INDEX.md`, ~500 tokens) das memórias do projeto (`01-context/`, `02-specs/`, `03-decisions/`, `docs/architecture/`, `docs/testing/`) para consulta rápida antes de mergulhar em arquivos completos. Inclui suporte OPCIONAL a `qmd` (BM25/vsearch local via npm ou bun, modelos GGUF ~2GB auto-download). Orquestra `memory-curator` (em modo update) para refazer o INDEX após mudanças permanentes na fase 5 do SDD. Gatilhos: "lembrar", "índice", "consultar memória", "atualizar INDEX", "qmd search".
---

# Memória token-efficient do projeto SDD

Reduz o custo de contexto de orquestrações que precisam "retomar o trabalho". Em vez
de reler `01-context/`, `02-specs/`, `03-decisions/`, `docs/architecture/`, `docs/testing/`
em cada sessão, o agente consulta primeiro `INDEX.md` (~500 tokens) e só então `Read` com
`offset` nos arquivos que indexar.

## Pipeline

```
mudança permanente (fase 5 do SDD)
  ├─ context-curator (modo update) refaz 01-context/
  └─ memory-curator          refaz project_sdd/INDEX.md
                                  ├─ varre 01-context/*.md
                                  ├─ varre 02-specs/*/spec.md
                                  ├─ varre 03-decisions/ADR-*.md
                                  ├─ varre docs/architecture/*.md
                                  ├─ varre docs/testing/*.md
                                  └─ sintetiza path + título + heads de seção
```

## Princípios

1. **Índice é cache, não source of truth.** O conteúdo real está nos arquivos. INDEX
   desatualizado = fallback para `grep -rn` (não mergulhar arquivos à-toa).
2. **~500 tokens.** Sem narrativa, sem descrição longa — só `path | título | ## heads`.
3. **Paths grep-friendly.** Toda referência é caminho relativo real (igual
   `shared/doc-structure.md`).
4. **Idempotente.** Reextrair em conteúdo igual produz INDEX byte-a-byte (exceto
   `updated:` na front-matter).
5. **KPIs no topo.** `## KPIs` com contadores (trilhas abertas/bloqueadas/prontas,
   ADRs propostos, premissas não confirmadas). É o "checkpoint de sessão" <300 tokens.

## Uso típico

Antes de mergulhar em `01-context/*.md`:

```
1. Read project_sdd/INDEX.md                           (~500 tokens)
2. Identifique 2-3 arquivos candidatos à sua pergunta
3. Read específico com offset (seção identificada pelo INDEX)
```

Nunca leia `01-context/` completo sem primeiro consultar INDEX — é desperdício de
contexto que costuma saturar a sessão inteira.

## QMD opcional (apenas se quiser busca semântica)

Instalável via **npm** (`npm install -g @tobilu/qmd`) **ou** **bun** (`bun install -g
@tobilu/qmd`) — qualquer um serve, exigindo Node 22+ ou Bun 1+. `init.ps1`/`init.sh`
perguntam no bootstrap se você quer instalar. **Default do template não exige** — índice
curado cobre 99% dos usos. Setup completo em `references/qmd-optional.md`.

## Quando atualizar INDEX

- Ao final de cada fase 5 do SDD (delegue ao `context-curator` em modo update — ele
  dispara `memory-curator`).
- Após `/generate-architecture` ou `/tests-release` que gravam em `docs/`.
- Manual: `pwsh skills/memory/extract-index.ps1 <SDD_ROOT>` quando houver muita mudança
  permanente sem rodar SDD formal (raro).

## Limitação

QMD com modelos GGUF locais (1-2GB) é caro quando você só consulta a string "orders".
Índice curado + `grep -rn` resolve 95% dos casos. Reserve QMD para buscas semânticas
justificadas.

## Não faça

- Não escreva INDEX à-mão; é gerado. Edit manual vira divergência.
- Não inclua código de produção no INDEX — só docs do SDD.
- Não confunda INDEX com STATUS.md (que tem só a tabela de trilhas).
- Não rode `qmd embed` dentro de uma sessão sem lock serializado — pode travar user (ver
  `references/qmd-optional.md`).