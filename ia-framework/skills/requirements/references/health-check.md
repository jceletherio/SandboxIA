# Health check do `01-context/requirements.md`

Critério objetivo da saúde do documento de requisitos extraído. O `requirements-doctor`
aplica as 8 dimensões abaixo e score 0-100. **Sempre apresenta o relatório** e:

- score <50 → `blocked` → aborta próximo command sem perguntar (bloqueio mandatório).
- score 50-79 → `needs_revision` → pergunta continuar/resolver ao usuário.
- score ≥80 → `healthy` → pergunta continuar/resolver ao usuário.
- `--strict` → baixa threshold de bloqueio para <80 (i.e. 50-79 também bloqueia).

Heurística baseada em `grep`/regex + LLM. **Nunca afirme certeza absoluta** — toda
afirmação vem com `evidence: arquivo:linha`.

## 8 dimensões

### Dimensão 1 — Parseability & Front-matter

Verifica se o `01-context/requirements.md` tem front-matter YAML válido com os campos
obrigatórios: `title`, `source`, `extracted`, `hash`, `kpis`.

Heurística:

- Linha 1 iniciando com `---` e segundo bloco `---` antes de `# ` heading.
- `grep -m1 '^source:\s*\S+'` — existe?
- `grep -m1 '^hash:\s*sha256:\S+'` — existe e confere com arquivo-fonte?
  - Rele `source:` (caminho relativo ao monorepo), computa `sha256sum <source>`, compara.
- `grep -m1 '^kpis:\s*\{.*health:\s*\w+.*\}'` — existe?

Finding `high` se faltar campo; `critical` se hash divergente.

### Dimensão 2 — Visão do produto

Verifica seção `## Visão do produto` (ou equivalente, ex.: "Visão") tem 1 parágrafo
+ 3-5 bullets.

Heurística: localize a seção, capture até próximo `## ` heading. Conte bullets `^- `.
Stub se <3 bullets ou parágrafo vazio entre heading e primeiro bullet.

- Finding `medium` se ausente.
- Finding `low` se stub (<3 bullets).

### Dimensão 3 — Epics / Features

Verifica se a seção lista pelo menos 1 EPIC e Features com IDs. IDs preservados do
fonte ou `[INFERIDO]` marcado explicitamente.

Heurística: `grep -c '^\-\s*\*\*EPIC-'` — count ≥1; `grep -c '^\s*Feature\s+F-'` ou
`^\s*- Feature` para features. Para cada EPIC, check se tem `fonte: §X` (path real)
ou `[INFERIDO]`.

- Finding `high` se zero epics/features.
- Finding `low` se IDs inferidos sem etiqueta `[INFERIDO]`.

### Dimensão 4 — Histórias de usuário

Para cada `**US-NNN**` (formato bullet `^\-\s*\*\*US-\d+`):

- Tem `**Como** <papel>`,
- Tem `**Quero** <ação>,`
- Tem `**Para** <valor>.`
- Tem `**Critérios de aceite:**` seguido de ≥1 bullet `N.` ou `N)`.
- Tem `fonte: §<seção>` (path/§, não inventado).

Heurística via regex por bloco (linhas entre `**US-NNN**` e próximo `**US-` ou `## `).
CA não encontrado → finding `high` (CA ausente = alucinação garantida em implementação).

### Dimensão 5 — RF (Requisitos Funcionais)

Tabela markdown com colunas `| RF-ID | Descrição | Prioridade | Fonte |`.

Para cada RF `^\|\s*RF-\d+`:

- ID presente (`RF-N>`).
- Descrição observável começando com verbo: regex `deve|shall|will|permite|suporta|exige|impende` em coluna descrição.
- Prioridade declarada em coluna: `alta|media|baixa|must|should|could|won't`. String vazia → finding.
- `fonte: §X` na última coluna.

Finding `high` se zero RF. Finding `medium` se RF sem prioridade (cap -25 ao score).
Finding `low` se descrição não observável.

### Dimensão 6 — RNF (Requisitos Não Funcionais)

Tabela markdown `| RNF-ID | Descrição | Categoria | Métrica | Fonte |`.

Para cada RNF `^\|\s*RNF-\d+`:

- Categoria válida (uma de): `performance|seguranca|observabilidade|usabilidade|conformidade|availability|scalability|resilience`.
- Métrica declarada (não vazia).
- `fonte: §X`.

Cobertura: contar categorias *distintas*. <3 categorias → finding `medium`.

Finding `high` se zero RNF. Finding `medium` se <3 categorias distintas. Finding `low`
se métrica ausente.

### Dimensão 7 — Lacunas etiquetadas

Toda inferência deve ser etiquetada: `[AMBIGUO]`, `[CONFLITO]`, `[AUSENTE]`, `[INFERIDO]`.
Procurar inferência escondida (sem etiqueta vizinha):

- Frases marcadoras: `assumindo|presumindo|deve ser|provavelmente|talvez|acho que|acredita` +
  ausência de etiqueta `[X]` na mesma linha (ou close, 2 linhas).
- `grep -n -E '(assumindo|presumindo|provavelmente|talvez|acho (que)?|acredita)'` e checa
  contexto ±2 linhas por etiqueta — se não há etiqueta, vira finding `high`.

Inferência explícita é OK: `[AMBIGUO] X é ambíguo`, `premissa: <X>`. Etiqueta obriga
auditoria posterior.

Finding `high` por ocorrência de inferência escondida. Finding `medium` se a seção
"Lacunas encontradas" está vazia e há inferências no corpo (vira backlog implícito).

### Dimensão 8 — Coerência estrutural

Verifica se as seções esperadas pelo template (`formats.md`) existem, nesta ordem:

1. `## Visão do produto` (ou `Visão`)
2. `## Epics / Features`
3. `## Histórias de usuário`
4. `## Requisitos funcionais (RF)`
5. `## Requisitos não funcionais (RNF)`
6. `## Restrições`
7. `## Premissas`
8. `## Lacunas encontradas`
9. `## Glossário` (opcional — se houver termos definidos)

Para cada seção esperada: `^##\s+` no arquivo. Vazio (linhas entre heading e `## `
próximo contendo apenas blank/zero bullets) → finding `medium`.

Finding `low` se seção esperada ausente. Finding `medium` seções esperadas vazias.

## Scoring 0-100

Starts 100. Penalties acumulativas (cap em -50 total de penalty de uma dimensão):

| Dimensão | Penalty quando |
|---|---|
| Front-matter | -10 por campo faltante (`title`/`source`/`extracted`/`hash`); -10 se hash divergente |
| Visão | -15 se ausente; -8 se stub (<3 bullets) |
| Epics | -20 se zero; -5 por ID inferido sem etiqueta `[INFERIDO]` (cap -15) |
| Histórias | -5 por US sem CA (cap -25); -3 por US sem `fonte: §` (cap -15) |
| RF | -20 se zero; -3 por RF sem prioridade (cap -15); -2 por RF não-observável (cap -10) |
| RNF | -15 se zero; -10 se <3 categorias; -3 por RNF sem métrica (cap -15) |
| Lacunas | -8 por inferência escondida (cap -25); -10 se "Lacunas encontradas" vazio mas há inferências |
| Coerência | -5 por seção esperada ausente; -3 por seção vazia (cap -15) |

Score final: `max(0, 100 - sum(penalties))`.

## Auto-block conditions (override score)

Mesmo se score ≥50, **bloqueia** (verdict `blocked`, sem perguntar continuar/resolver)
quando ocorre qualquer:

1. Extract retorna vazio (PDF escaneado sem OCR detectado; saída extract.<ps1|sh> tem
   <100 chars não-whitespace).
2. Zero RF **e** zero US, **a menos** que usuário declarou `--migration` (ou confirmação
   interativa "é migration/refactor sem escopo de features?").
3. Hash divergente do arquivo fonte citado em `source:`.
4. ≥3 ocasiões de `[CONFLITO]` sem `[AMBIGUO]` correspondente tentando resolver
   silenciosamente (padrão: `[CONFLITO] ... logo <decisão>` sem etiqueta de ambiguidade
   → bloqueio; usuário decide).

### Migration override

`requirements-doctor` detecta zero US **e** zero RF:

- Se `--migration` arg: skip auto-block 1 e 2; `context: migration`; `verdict: needs_revision`
  (mesmo se score ≥80) com nota `"escopo migration aceito"`.
- Se sem flag e interativo: pergunta `"Documento não tem US/RF — é migration/refactor
  (sem escopo de features)? [y/N]"`. `y` aplica override; `n` ou vazio mantém auto-block.

### `--strict`

- Threshold de bloqueio: <80 (default <50).
- Score 50-79 vira `blocked` (não `needs_revision`).
- `--strict` **não** exige `--migration` adicionalmente para auto-block por zero US/RF.

## Snapshot persistido

Cada execução persiste em:

```
project_sdd/01-context/requirements-health/
  vNNN-YYYY-MM-DDTHH-MM-SS.md         # 1 vez incremental
  INDEX.md                             # cache de auditoria
```

Numeração `vNNN` zero-padded 3 dígitos, incremental monótono. Reexecução nunca
sobrescreve.

`--no-save`: não persiste; apenas retorna JSON + printa report ao usuário.

## `kpis.health` no `requirements.md`

Doctor sempre atualiza front-matter do `requirements.md`:

```yaml
kpis:
  health: green|yellow|red|blocked
  last_check: 2026-08-05T14:32:01Z
  last_score: 72
```

Sem `--no-save`.

## Não faça

- Não afirme certeza absoluta sobre qualidade — sempre reporta `evidence: arquivo:linha`.
- Não corrija o `requirements.md` automaticamente — apenas reporta findings.
- Não substitua entrevista humana; se finding `high` é sem resolvável, marque
  `ENTREVISTAR <stakeholder>` no `recommendations`.
- Não persista `INDEX.md` mais que 1 linha por execução.
- Não dependa de `qmd` para health check — `grep -n` basta.
- Não rode doctor antes de `requirements-reader` persistir `requirements.md` — ataca
  o arquivo que ele produziu.