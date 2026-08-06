# Formatode saída — `01-context/requirements.md`

O `requirements-reader` normaliza o texto extraído neste template. Referência de escrita
em `skills/shared/doc-structure.md`.

## Front-matter (lido por ferramentas)

```yaml
---
title: Requisitos extraídos
source: requisito.docx          # caminho relativo ao monorepo
extracted: 2026-08-05
hash: sha256:<digest do arquivo fonte>
kpis: { health: green }
---
```

`health`:
- `green` — documento legível, sem lacunas críticas
- `yellow` — extração parcial (alguma seção ambígua ou conflitante)
- `red` — falha de parsing ou mais de 20% de lacunas

## Seções obrigatórias (nesta ordem)

### 1. Visão do produto

Um parágrafo curto + 3-5 bullets. **Só o que está no documento.** Sem inferência de
roadmap.

### 2. Epics / Features

ListeEpics e Features identificados no fonte, preservando IDs originais quando houver:

- **EPIC-01 — Catálogo** (fonte: §2.1)
  - Feature F-01: listagem de produtos
  - Feature F-02: busca por categoria

Sem ID no fonte? Atribua `EPIC-<slug>` + anote em lacunas que era inferido.

### 3. Histórias de usuário

```md
- **US-007 — Checkout Express** (fonte: §3.2)
  - **Como** comprador recorrente,
  - **Quero** finalizar compra sem redigitar endereço,
  - **Para** reduzir tempo de checkout.
  - **Critérios de aceite:**
    - 1) Usuário logado vê endereço pré-carregado
    - 2) Pode editar antes de confirmar
    - 3) Sem endereço salvo, fluxo padrão
```

Sem critérios de aceite no fonte → marque `[AMBIGUO: critérios de aceite ausentes]`.

### 4. Requisitos funcionais (RF)

| RF-ID | Descrição | Prioridade | Fonte |
| ----- | --------- | ---------- | ----- |
| RF-12 | Sistema deve permitir checkout em até 3 cliques | alta | §3.2 |

Prioridade: `alta|media|baixa` ou o que o fonte trouxer (`must|should|could|won't`).

### 5. Requisitos não funcionais (RNF)

| RNF-ID | Descrição | Categoria | Métrica | Fonte |
| ------ | --------- | --------- | ------- | ----- |
| RNF-03 | checkout p95 < 2s | performance | latency | §5.1 |

Categoria: `performance|seguranca|observabilidade|usabilidade|conformidade|availability|scalability`.

### 6. Restrições

```md
- **Tecnológicas:** Postgres 16+, sem vendor lock-in cloud (fonte: §4)
- **Negócio:** atendimento exclusivo B2B (fonte: §1)
- **Compliance:** LGPD conformidade para dados pessoais (fonte: §4.3)
```

### 7. Premissas

Coisas que **assumimos** para o `sdd-planner` avançar, mas que precisam confirmação:

```md
- Premissa: só haverá um tenant por instalação (não há menção a multi-tenancy no documento)
```

### 8. Lacunas encontradas

```md
- [AMBIGUO] §3.2 não define o que acontece quando o carrinho está vazio
- [CONFLITO] §3.1 diz "todos os pagamentos via cartão" mas §4.2 lista PIX
- [AUSENTE] Nenhum RNF de disponibilidade/SLA explicitado
```

Toda lacuna vira pergunta ao usuário em bloco quando o `sdd-planner` rodar.

### 9. Glossário

```md
- **Checkout Express:** fluxo para compradores recorrentes logados
- **SKU:** unidade de produto no catálogo
```

## Não entre aqui

- Interpretação implícita além do que diz o fonte.
- Roadmap, priorização de release, divisão em sprints — isso é `sdd-planner`.
- Decisões arquiteturais — isso é `<stack>-arquiteto`.