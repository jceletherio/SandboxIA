# Convenção de `01-context/screens/<id>.md`

Toda tela ingerida vira um arquivo com as seções abaixo. O `screens-reader` escreve
exatamente neste formato.

## ID e front-matter

```yaml
---
title: Tela — <nome>
screen_id: S-NNN
source: req/screens/<arquivo.png>
updated: 2026-08-05
kpis: { health: green }
---
```

`screen_id` é **estável**: reingestão ou referência no plano usa o mesmo ID. Atribuição
feita pelo `screens-reader` na ordem de processamento. Reingestão com mesmo `source`
hash atualiza descrição, mantém `screen_id`.

## Seções obrigatórias (nesta ordem)

### 1. Propósito
1 parágrafo curto: qual jornunta do produto esta tela serve.

### 2. Layout (estrutura visual)
Descrição da posição de blocos principais. Use bullet de "zonas" para facilitar o
implementador Angular estruturar template/componentes:

- **Cabeçalho** (topo): breadcrumbs em `<title>` + ação primária à direita
- **Sidebar esquerda** (240px): filtros (`status`, `data range`)
- **Conteúdo central** (flex-1): tabela principal com checkbox + linhas
- **Footer** (40px): paginação + total de registros

### 3. Componentes esperados
Lista de componentes UI previstos (ex.: `app-orders-table`, `app-filter-panel`,
`app-empty-state`, `app-skeleton`). Nomes em kebab-case coerente com naming do
projeto Angular (`shared/ui/`).

### 4. Paths / interações
Jornadas do usuário na tela:

- Clicar botão "Novo pedido" → abre modal `app-order-form`
- Clicar linha da tabela → vai para `/orders/<id>` via `routerLink`
- Filtrar status "Pago" → atualiza `httpResource` com query param `?status=paid`

### 5. Estados (loading / erro / vazio)
Obrigatório três estados:

- **Loading**: skeleton no lugar da tabela (10 linhas fadeIn)
- **Erro**: `app-error-state` com mensagem + bot "Tentar novamente"
- **Vazio**: `app-empty-state` com ilustração + CTA "Criar primeiro pedido"

### 6. A11y esperada
- Todos os botões icon-only precisam `aria-label`
- Tabela usa `role="table"` com `scope="col"` no header
- Filtros tem `<label>` visível ou `sr-only`
- Ordem de tab segue fluxo visual (top → down → footer)
- Contraste AA (verificar com axe-core em E2E)

### 7. Dados consumidos
Endpoints/Angular services que a tela usa. Referencia IDs de contrato em
`01-context/api-context.md`:

- `httpResource<OrdersPage>('/api/v1/orders')`
- `CartService` para badge no cabeçalho

### 8. Outras telas relacionadas
- Anterior: `S-002` (lista)
- Próxima: `S-004` (detalhe)
- Modal: `S-005` (criar)

## Não entre aqui

- Implementação — isso é o `/sdd` normal.
- Decisão de design system (cor spec, tipo tipografia) — capturas da tela referem-se ao
  que está na imagem; tokens vivem em `src/frontend/styles/`.
- Métricas de conversão ou KPIs de produto — captura técnica.