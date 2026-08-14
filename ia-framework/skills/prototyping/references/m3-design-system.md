# Material Design 3 — referência de design system

> Fonte canônica: <https://m3.material.io/> (fundations, components, styles). Este doc é o
> subconjunto que o `prototype-designer` e o `prototype-reviewer` aplicam no protótipo.
> Regra dura: **toda decisão visual vira token** — nenhum hex/px/weight solto.

## 1. Cor (Dynamic Color / color roles)

M3 gera uma paleta tonal (HCT) a partir de uma **seed color**; o tema expõe **color roles**
(uso semântico), não cores livres. No protótipo, defina a seed e use só os roles.

Roles principais:

| Role | Uso |
| --- | --- |
| `primary` / `on-primary` | elemento de destaque (botão filled, FAB, selected chip) |
| `primary-container` / `on-primary-container` | superfícies de destaque suave |
| `secondary` / `secondary-container` | ações auxiliares |
| `tertiary` / `tertiary-container` | destaque complementar |
| `error` / `on-error` / `error-container` | erro, validação, destruição |
| `surface` / `on-surface` | fundo padrão e conteúdo |
| `surface-container-lowest/low/high/highest` | hierarquia de elevação de superfície |
| `surface-variant` / `on-surface-variant` | áreas neutras, chips, field fill |
| `outline` / `outline-variant` | bordas, dividers, inputs disabled |
| `surface-tint` | cor do elevation overlay |

- **Contraste AA:** texto normal ≥ 4.5:1, texto grande ≥ 3:1 sobre o fundo. Nunca comunicar
  estado só com cor (ex.: erro = cor + ícone + texto).
- **Dark/light:** o protótipo deve suportar os dois schemes via tokens (`light`/`dark`), com
  o tema definido em um único lugar (ex.: `mat.define-theme` no Angular Material, ou CSS
  custom properties `--md-sys-color-*`).

## 2. Tipografia (type scale)

15 estilos em escala definida — pesos 400/500/700, família default Roboto. Use os estilos,
não sizes arbitrários:

| Estilo | Tamanho/leading | Uso |
| --- | --- | --- |
| `display-large/medium/small` | 57/52/44 · 64/56/52 | hero, títulos de página raros |
| `headline-large/medium/small` | 32/28/24 | títulos de tela/seção |
| `title-large/medium/small` | 22/16/14 | título de app bar, títulos de card, subtítulos |
| `body-large/medium/small` | 16/14/12 | corpo de texto |
| `label-large/medium/small` | 14/12/11 | labels de botão, chips, campos, tooltip |

## 3. Formas (shape)

Escala de cantos arredondados — aplicada por componente, nunca livremente:

- `none` 0 · `extra-small` 4 · `small` 8 · `medium` 12 · `large` 16 · `extra-large` 28 ·
  `full` 999.

Padrões comuns: botões/fab = `full`; cards = `medium/large`; text fields = `extra-small`;
bottom sheets = `extra-large` no topo; dialogs = `extra-large`.

## 4. Elevação e superfícies

- Elevação tonal por camadas de `surface-container-*` (melhor que sombra em claro).
- Níveis de sombra 0-5 apenas quando necessário (dialog, fab, bottom sheet).
- **State layers** em interação: `hover` (8% on-surface), `pressed` (12%), `focus`
  (12%), `dragged` (16%). O componente aplica; não inventar overlay próprio.

## 5. Espaçamento e densidade

- Grid base de **8dp** (margens/semanticas múltiplos de 8; micro-gaps podem usar 4dp).
- Margens de tela: 16dp (mobile), 24dp (desktop).
- **Touch target mínimo 48×48dp** (conteúdo pode ser 40×40 com padding até 48).
- Densidade: default `0`; compacto `-1`/`-2` só em tabelas/forms densos, com meta-a11y.

## 6. Componentes (subconjunto M3)

| Componente | Quando usar |
| --- | --- |
| Top app bar | navegação de nível superior + título + ações |
| Navigation bar / drawer | navegação (mobile bar, desktop drawer) |
| Buttons: `filled`/`tonal`/`outlined`/`text`/`elevated`/`icon` | hierarquia de ação (primary/emphasis/standard/danger/low) |
| FAB / Extended FAB | ação principal da tela em destaque |
| Card: `elevated`/`filled`/`outlined` | agrupamento de conteúdo (listas, grids) |
| Text fields (outlined/filled) | entrada de dados — sempre com label + `error-text` + helper |
| Select / dropdown menu | escolha de opções |
| Chips: `assist`/`filter`/`input`/`suggestion` | filtros e atribuição |
| Data table | dados tabulares densos (ordenável, selecionável) |
| List | itens com leading/trailing (menus, navegação) |
| Checkbox / Switch / Radio | seleção (switch p/ on/off imediato) |
| Tabs | alternar views no mesmo contexto |
| Dialog (alert/full-screen) | confirmação/destruição (alert) ou tarefa focada |
| Bottom sheet | ações contextuais (mobile) |
| Snackbar | feedback de ação concluída (não bloqueante) |
| Progress: `linear`/`circular` | loading (determinado/indeterminado) |
| Skeleton | loading de conteúdo esquelético |
| Tooltip / Search bar / Date picker | conveniência |

Regras de componente: `filled` button = 1 por área (primário); `text` para secundário;
`outlined` para terciário. Diálogo de destruição = `error` + botão `filled`.

## 7. Layout e hierarquia

- **Hierarquia visual** por tokens (superfície, peso, tamanho), nunca por saturação de cor.
- Cabeçalho → conteúdo → ações: ordem natural de leitura; ações destrutivas no fim.
- Formulário: 1 coluna mobile, 2+ colunas desktop por grupos; agrupar campos relacionados.
- Tabelas densas: sticky header, zebra opcional (surface-container-lowest), ações com ícones
  `icon-button` + `aria-label`.
- Empty state: ilustração/ícone + mensagem clara + CTA (ação seguinte).
- Error state: mensagem + ação "Tentar novamente".

## 8. Estados (loading / erro / vazio)

Obrigatórios em toda lista/visualização:

- **Loading:** skeleton (pulso) ou progress indeterminado; nunca "tela branca".
- **Erro:** `error` role + mensagem legível + retry. Backend fora → mensagem de rede.
- **Vazio:** sem dados → empty state com CTA. Filtrar sem resultado → "nenhum resultado
  para os filtros" + limpar filtros.

## 9. Acessibilidade (a11y)

- Contraste AA (ver §1). Touch target ≥ 48dp (ver §5).
- **Nada comunicado só por cor.** Ícone + texto + `aria-*` sempre.
- Form fields: `<label>` visível ou `aria-label`; erro ligado via `aria-describedby`.
- Navegação por teclado completa (Tab, Enter, Esc, setas em menus/tabs); foco visível.
- Listas/tabelas: `role` e semântica corretos (`table` com `scope="col"`, listas com
  `ul/li`), `lang` correto no documento.
- Motion: respeitar `prefers-reduced-motion` (skeleton/snackbar podem ficar estáticos).

## 10. Checklist rápido do designer (por tela)

1. Todas as cores de role, nunca hex? (dark/light cobertos?)
2. Type scale, não sizes arbitrários?
3. Shapes do scale, não cantos livres?
4. Estados loading/erro/vazio definidos?
5. Touch targets ≥ 48dp; contraste AA?
6. Ações hierarquizadas (1 filled por área)?
7. Componente M3 certo para o papel (não reimplementar com divs)?
