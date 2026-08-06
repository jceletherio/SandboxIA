# Placeholder para tela S-001 — Orders list

> Este arquivo ensina como o usuário adicionaria uma tela real. Em projeto real,
> substitua por `.png` exportado do Figma/Adobe/Sketch.

## Como obter o PNG real

1. No Figma/Adobe, exporte a tela com layout > 800x600 → `req/screens/orders-list.png`.
2. Rode `/load-screens req/screens/` no orquestrador — anexe a imagem ao prompt atual
   (a maioria dos orquestradores suporta anexar imagens via `@path/file.png` ou
   drag-and-drop no chat).
3. O `screens-reader` descreve a imagem em `project_sdd/01-context/screens/S-001-orders-list.md`
   — substituindo a versão placeholder atual do exemplo.

## Para o exemplo petshop

A versão do arquivo `01-context/screens/S-001-orders-list.md` neste exemplo foi escrita
sabendo o que a tela deveria conter (lista de pedidos com skeleton, vazio e erro). Em
projeto real, o `screens-reader` extraído do PNG (via vision) geraria aquela descrição
automaticamente.