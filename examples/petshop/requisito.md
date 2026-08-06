# Petshop — Requisitos do produto

> Documento curto para demonstrar o pipeline `/plan-from-requirements`. Equivale a um
> `.docx`/`.pdf` real变小; no seu projeto você coloca seu documento aqui.

## Visão

Petshop **PetLover** quer sistema web para MVP de vendas de produtos de pet. Público:
tutores 25-50 anos. Volume esperado: 2000 produtos, 500 pedidos/mês no MVP.

## Epics

- **EPIC-01 — Catálogo**: listagem de produtos com busca por nome e filtro por categoria.
- **EPIC-02 — Checkout**: criar pedido com carrinho, dados de entrega e pagamento PIX
  ou cartão.

## Histórias de usuário

- **US-001 — Listar produtos** (EPIC-01)
  - **Como** tutor,
  - **Quero** ver lista de produtos com foto, nome, preço,
  - **Para** escolher o que comprar.
  - **CA**:
    1. 12 produtos por página
    2. Ordenação por nome e preço
    3. Estado vazio quando categoria selecionada não tem items

- **US-002 — Buscar produto** (EPIC-01)
  - **Como** tutor,
  - **Quero** buscar por nome parcial,
  - **Para** achar rápido.
  - **CA**:
    1. Busca case-insensitive
    2. Resultado em até 200ms p95

- **US-003 — Criar pedido** (EPIC-02)
  - **Como** tutor logado,
  - **Quero** finalizar compra com PIX ou cartão,
  - **Para** receber o produto em casa.
  - **CA**:
    1. Carrinho vazio não permite checkout
    2. Formulário de endereço (CEP, rua, número, complemento)
    3. Confirmação exibe total + prazo + número do pedido
    4. E-mail de confirmação enviado (fora de escopo desta release)

## Requisitos funcionais (RF)

| RF-ID | Descrição | Prioridade |
| ----- | --------- | ---------- |
| RF-01 | Sistema deve listar produtos com paginação 12/página | alta |
| RF-02 | Sistema deve permitir busca por nome parcial (case-insensitive) | alta |
| RF-03 | Sistema deve suportar checkout em até 3 cliques | alta |
| RF-04 | Sistema deve aceitar pagamento via PIX e cartão | alta |
| RF-05 | Sistema deve exigir login para checkout | alta |
| RF-06 | Sistema deve registrar endereço de entrega por pedido | média |

## Requisitos não funcionais (RNF)

| RNF-ID | Descrição | Categoria | Métrica |
| ------ | --------- | --------- | ------- |
| RNF-01 | Busca de produtos p95 ≤ 200ms | performance | latency |
| RNF-02 | Checkout p95 ≤ 2s | performance | latency |
| RNF-03 | API REST versionada `/api/v1/` | seguranca | versionamento |
| RNF-04 | Dados PII (email, endereço) cripto em trânsito (TLS) | seguranca | TLS |
| RNF-05 | Multi-tenant com RLS em todas as tabelas | seguranca | isolamento |
| RNF-06 |SLA 99.5% disponibilidade | availability | uptime |

## Restrições

- **Tecnológicas**: Postgres 16+, sem vendor cloud-lock (deploy em qualquer cloud).
- **Negócio**: atendimento exclusivamente B2C.
- **Compliance**: LGPD conformidade para PII (email, endereço, telefone).

## Premissas

- Premissa: só haverá um tenant por instalação (sem menção a multi-loja no requisito).

## Lacunas encontradas

- [AMBIGUO] §US-003 não define prazo de entrega (prazo-alvo que o sistema deve mostrar).
- [AUSENTE] Sem RNF explícito para rate-limit.

## Glossário

- **Tutor**: dono do pet, usuário do sistema.
- **PII**: personal identifiable information (LGPD).