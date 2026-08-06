---
title: Requisitos extraídos
source: requisito.md
extracted: 2026-08-05
hash: sha256:example-placeholder
kpis: { health: yellow }
---

# Requisitos extraídos — Petshop PetLover

## Visão do produto

Sistema web para MVP de vendas de produtos de pet. Público: tutores 25-50 anos. Volume
esperado: 2000 produtos, 500 pedidos/mês no MVP.

## Epics / Features

- **EPIC-01 — Catálogo**
  - Feature F-01: listagem de produtos com busca
  - Feature F-02: detalhe de produto
- **EPIC-02 — Checkout**
  - Feature F-03: carrinho e checkout

## Histórias de usuário

- **US-001 — Listar produtos** (fonte: requisito.md §US-001)
  - **Como** tutor, **Quero** ver lista de produtos com foto, nome, preço, **Para**
    escolher o que comprar.
  - **CA**: 12/página; ordenação nome/preço; estado vazio por categoria.
- **US-002 — Buscar produto** (fonte: §US-002)
  - **Como** tutor, **Quero** buscar por nome parcial, **Para** achar rápido.
  - **CA**: case-insensitive; p95 ≤ 200ms.
- **US-003 — Criar pedido** (fonte: §US-003)
  - **Como** tutor logado, **Quero** finalizar com PIX/cartão, **Para** receber em casa.
  - **CA**: carrinho vazio não permite; formulário endereço; confirmação com total +
    prazo + número; email de confirmação fora desta release.

## Requisitos funcionais (RF)

| RF-ID | Descrição | Prioridade | Fonte |
| ----- | --------- | ---------- | ----- |
| RF-01 | Listar produtos com paginação 12/página | alta | §RF-01 |
| RF-02 | Busca por nome parcial case-insensitive | alta | §RF-02 |
| RF-03 | Checkout em até 3 cliques | alta | §RF-03 |
| RF-04 | Pagamento PIX e cartão | alta | §RF-04 |
| RF-05 | Login obrigatório para checkout | alta | §RF-05 |
| RF-06 | Endereço de entrega por pedido | média | §RF-06 |

## Requisitos não funcionais (RNF)

| RNF-ID | Descrição | Categoria | Métrica | Fonte |
| ------ | --------- | --------- | ------- | ----- |
| RNF-01 | Busca p95 ≤ 200ms | performance | latency | §RNF-01 |
| RNF-02 | Checkout p95 ≤ 2s | performance | latency | §RNF-02 |
| RNF-03 | API REST versionada `/api/v1/` | seguranca | versionamento | §RNF-03 |
| RNF-04 | PII em TLS | seguranca | TLS | §RNF-04 |
| RNF-05 | Multi-tenant RLS em todas tabelas | seguranca | isolamento | §RNF-05 |
| RNF-06 | SLA 99.5% | availability | uptime | §RNF-06 |

## Restrições

- **Tecnológicas:** Postgres 16+, sem vendor cloud-lock (requisito.md §Restrições).
- **Negócio:** atendimento exclusivamente B2C.
- **Compliance:** LGPD para PII.

## Premissas

- Premissa: só haverá um tenant por instalação — não há menção a multi-loja no doc fonte.

## Lacunas encontradas

- [AMBIGUO] US-003 não define prazo de entrega que o sistema deve mostrar.
- [AUSENTE] Sem RNF explícito para rate-limit.
- [IGNORED] telas em req/screens/ (1 placeholder) — rode `/load-screens` para ingerir.

## Glossário

- **Tutor:** dono do pet, usuário.
- **PII:** personal identifiable information (LGPD).