---
title: Tela — Lista de Pedidos (Orders list)
screen_id: S-001
source: req/screens/orders-list.png
updated: 2026-08-05
kpis: { health: green }
---

# Tela — Lista de Pedidos

> Exemplo — descrição que o `screens-reader` extraía de um PNG anexado. No exemplo,
> escrita à-mão para demo fluência do fluxo. Em projeto real, `/load-screens` gera.

## Propósito

Listar pedidos do tutor autenticado, com filtros por status e estado de loading/erro/vazio.

## Layout

- **Cabeçalho** (topo, 64px): título "Meus Pedidos" + breadcrumb + botão "Novo Pedido" à direita
- **Sidebar** esquerda (240px): filtros — status (`Aberto`, `Pago`, `Enviado`,
  `Cancelado`), data range
- **Conteúdo central** (flex-1): tabela com colunas `# | Data | Total | Status | Ações`
- **Footer** (40px): paginação + total "12 pedidos"

## Componentes esperados

- `app-orders-list` — feature container (signal vm = `httpResource`)
- `app-orders-table` — tabela com checkbox + `track`
- `app-order-filter-panel` — sidebar filtros
- `app-skeleton` — para estado loading
- `app-empty-state` — estado vazio com CTA
- `app-error-state` — estado erro com retry

## Paths / interações

- Clicar linha da tabela → navegar para `/orders/<id>` (`routerLink`)
- Clicar "Novo Pedido" → abrir modal `app-order-form`
- Filtrar status "Pago" → `httpResource` refetch com `?status=paid`

## Estados loading / erro / vazio

- **Loading**: skeleton de 10 linhas fadeIn (substitui a tabela).
- **Erro**: `app-error-state` com mensagem "Falha ao carregar pedidos" + botão
  "Tentar novamente".
- **Vazio**: `app-empty-state` com ilustração + CTA "Fazer primeiro pedido".

## A11y esperada

- Tabela usa `role="table"` com `scope="col"` no header.
- Botões icon-only (X de fechar, "?" help) têm `aria-label`.
- Filtros têm `<label>` visível.
- Ordem de tab segue fluxo top → bottom (cabeçalho → sidebar → tabela → footer).

## Dados consumidos

- `httpResource<OrdersPage>('/api/v1/orders')` — lista paginada.
- `CartService` para badge no cabeçalho (carrinho count).
- Referência: `01-context/api-context.md` §orders.

## Telas relacionadas

- Próxima: `S-002` (detalhe do pedido) — neste exemplo não foi ingerida.
- Modal: `S-003` (novo pedido) — não ingerida.