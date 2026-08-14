---
title: Design — <nome da tela>
part_id: P-NNN
screen_id: <S-NNN se existir>
source: project_sdd/01-context/prototype/plan.md
requirements: [RF-ID, US-ID]
updated: <data>
kpis: { health: green }
---

# Design — <nome da tela> (Parte P-NNN)

> Gerado por `prototype-designer` (F2 do `/prototype-screens`) seguindo
> `references/m3-design-system.md`. Design de tela, não spec de produção.

## Propósito e contexto

<1 parágrafo: o que o usuário faz nesta tela; de onde vem (navegação/parte anterior)>

## Requisitos cobertos

- <RF-ID> <descrição curta>
- <US-ID> <descrição curta>

## Layout

- **Top app bar** (56/64dp): <título> + <ações>
- **Navegação**: <bar/drawer/tabs> <lado ou largura>
- **Corpo**: <áreas e proporções, grid 8dp>
- **Ações primárias**: <FAB ou botão filled, posição>

## Tokens M3 aplicados

- Cor: seed `<cor>`; roles: primary `<uso>`, surface-container `<uso>`, error `<uso>`
- Tipografia: `headline-small` no título, `body-medium` no corpo, `label-large` em botões
- Shape: `<componente>` = `<shape>`
- Elevação: `<componente>` = `<surface-container-* ou nível>`
- Espaçamento: margens `16dp`, gaps `8dp`/`16dp`

## Componentes M3

| Componente | Papel | Notas |
| --- | --- | --- |
| <componente M3> | <papel> | <estado/a11y/chip/filtro...> |

## Interações / fluxo

- Clicar <X> → <resultado>
- Filtrar <Z> → <efeito>
- Ação destrutiva → dialog `error` com confirmação

## Estados loading / erro / vazio

- **Loading**: <skeleton/progress, formato>
- **Erro**: <mensagem + retry>
- **Vazio**: <empty state + CTA>

## A11y

- <contraste/roles/labels/touch target/keyboard>
- <prefers-reduced-motion quando aplicável>

## Contrato de dados (mock → backend)

```ts
export interface <Domain>Gateway {
  <method>(<params>): Promise<<DTO>>;
}
// DTO:
export interface <DTO> { ... }
```

- Fixtures: `<arquivo>.ts` cobre <dados / vazio / erro>
- Provider a trocar: `{ provide: <TOKEN>, useClass: Mock<Domain>Gateway }`

## Pendências [AMBIGUO]

- <lacuna que precisa confirmação do usuário/negócio>
