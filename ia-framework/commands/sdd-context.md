---
description: Gera ou atualiza o 01-context do SDD multi-stack a partir da aplicação real — a memória que sessões futuras leem. Bootstrap inicial ou refresh. Utilitário, não é um fluxo de entrega.
args: [update]
---

Bootstrap ou refresh da **memória do projeto** (`01-context/`). Rode antes da primeira
trilha, e depois só quando arquitetura ou contrato mudou (fase 5 do SDD).

## Pré-voo

> Siga `skills/shared/preflight.md`. Verifique `ia-framework/STACK.md` configurado. Se faltar, pergunte ao usuário se quer rodar `/init` chained; se aceitar, delegate e retome; se não, abort com mensagem clara. (Este command gera o `01-context/`, então parte das invariáveis não precisa estar pronta ainda.)

## Modo

- Default: **bootstrap** — varre `.md` existentes + investiga código e sintetiza contexto.
- `$ARGUMENTS` contendo `update`: roda em modo **update** sobre a última trilha, em vez
  do bootstrap.

## Passos

1. Garanta a árvore SDD:
   ```
   pwsh skills/scaffold.ps1 init <SDD_ROOT>
   # (se não existe; senão pule)
   ```
2. **Colha o que já está documentado** (barato, sem ler cheio):
   ```
   pwsh skills/scaffold.ps1 harvest .
   # ou: bash skills/scaffold.sh harvest .
   ```
   Lista todos os `.md` da app (fora do SDD e de `node_modules`/`.git`/`ia-framework`)
   com front-matter + outline. Escolha o que vale ler de fato.
3. Delegue ao agente `context-curator` no modo informado:
   - **bootstrap** — lê o que importa, investiga o código de cada stack ativa (definida em
     `ia-framework/STACK.md`) e sintetiza `01-context/` seguindo
     `skills/shared/doc-structure.md`. Cada doc declara `stack` no front-matter
     (ou `multi` para docs cross-stack como `ARCHITECTURE_OVERVIEW.md`).
   - **update** — só doc afetado pela última trilha, e só se a arquitetura/contrato/mapa
     mudou.
4. **Confira por amostragem, você mesmo:** pegue 3–4 afirmações do que o curador escreveu e
   confronte com o código (`grep -n` + `Read` com `offset`). Errou em alguma? Mande o
   curador refazer aquele doc. Não delegue esta conferência a outro subagente: passar o
   contexto adiante custa mais do que abrir os arquivos.
5. Revise com o usuário o que **não** é inferível do código — `product-vision.md` e a parte
   de negócio de `constraints.md` são decisão dele, não do curador.