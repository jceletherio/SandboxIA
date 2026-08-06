---
description: Copia um arquivo de requisitos externo para a pasta req/ (ou req/screens/ se for imagem). Detecta extensão automaticamente: .docx/.pdf/.md/.txt → req/; .png/.jpg/.jpeg/.fig/.xd → req/screens/. Cria pastas se faltarem. Após copiar, sugere rodar /load-requirements (docs) ou /load-screens (telas). Não extrai conteúdo — apenas materializa o arquivo dentro do projeto.
args: <source-path> [--no-cascade]
---

Adiciona arquivo de requisitos ou tela ao projeto, copiando-a de qualquer lugar do disco
para dentro da árvore de req/.

## Quando usar

- Você tem um arquivo em `C:\Users\eu\Downloads\requisito.docx` e quer puxar para `req/`.
- Recebeu PNG de uma tela do Figma exportado e quer puxar para `req/screens/`.
- Em orquestradores que só aceitam paths no chat (common) e você não pode indicar
  binária ao LLM — `/req-add` é como "abrir pelo filesystem".

## Quando NÃO usar

- Para anexar imagem diretamente ao prompt (para LLM vision descrever em `/load-
  screens`) — use `/load-screens` direto com anexo.
- Para mover arquivos dentro de `req/` (`req/foo.docx` para `req/v2/foo.docx`) — basta
  `Edit`/`Bash` manual via outra invocação.

## Condução

1. `$ARGUMENTS` traz `<source-path>` — absoluto ou relativo ao repositório root.
   - Se caminho relativo (ex.: `~/Downloads/requisito.docx` em bash), expanda.
   - Se ausente: pergunte ao usuário "qual caminho do arquivo?"

2. Valide que arquivo existe:
   ```
   Test-Path -LiteralPath <source-path>
   ```
   Ausente → abort com mensagem "Arquivo não encontrado em <path>."

3. **Detecte extensão** (case-insensitive):
   - `.docx`, `.pdf`, `.md`, `.txt` → `req/`
   - `.png`, `.jpg`, `.jpeg`, `.fig`, `.xd`, `.sketch` → `req/screens/`
   - outra extensão → pergunte "extensão não suportada por essa detecção — colocar em
     `req/` mesmo? [Y/N]". Se "N", abort.

4. **Garanta diretório de destino**:
   ```
   New-Item -ItemType Directory -Force -Path req            # se for doc
   New-Item -ItemType Directory -Force -Path req/screens    # se for imagem
   ```
   (Bash: `mkdir -p` correspondente)

5. **Copie arquivo**:
   ```
   Copy-Item -LiteralPath <source-path> -Destination <dest> -Force
   ```
   (Bash: `cp -f <source> <dest>`)

6. **Confirma ao usuário**:
   ```
   /req-add OK
   source:       C:\Users\eu\Downloads\requisito.docx
   destination:  req/requisito.docx
   tamanho:      247KB
   ```

7. **Sugira próximo passo** (a menos que `--no-cascade` em `$ARGUMENTS`):
   - Para documentos: "rode `/load-requirements req/requisito.docx` para extrair e
     carregar em `01-context/requirements.md` (com health-check gate)."
   - Para telas: "rode `/load-screens req/screens/` anexando a imagem ao prompt do
     orquestrador para descrição via vision."
   - Em projetos intel large, em vez de sugerir automaticamente, pergunte "rode o
     próximo passo agora? [Y/N]".

## Pré-voo

Siga `skills/shared/preflight.md`. Se `ia-framework/STACK.md` não configurado OU
`project_sdd/01-context/` ausente → pergunte "rodar `/init` agora?". `req/` é criado
automaticamente por este command, mas prerequisitos básicos de template ainda valem.

## Flags

- `--no-cascade`: copia e mostra recibo sem sugerir próximo command. Útil em batch
  (multiple `/req-add` seguidos antes de `load`).

## Limitação

- Não extraí conteúdo — copia bytes apenas. Extração é `/load-requirements` (para docs
  textual) ou `/load-screens` (para imagens vision).
- Em orquestradores Sem filesystem access ao `C:\Users\eu\...`, request pode falhar.
  Nesse caso abort com mensagem "o orquestrador não expõe filesystem — mova o arquivo
  para dentro da raiz do repo manualmente e tente novamente com path relativo".
- Em Windows, paths com `\\` (UNC shares) às vezes exigem `cmd /c`; use `Bash` tool
  quando PowerShell falhar com UNC.

## Não faça

- Não mova (`Move-Item`) — sempre copia (`Copy-Item`/`cp`), preserva source original.
- Não chame `load-requirements` automaticamente sem confirmar — usuário pode querer
  adicionar 3 requisitos docx antes de um load único.
- Não edite `req/` existente manualmente (renomear/etc) — só o file_source → req/dest.
- Não valide conteúdo do arquivo (parse) — isso é "/load-requirements" depois.
- Não sobrescreva sem avisar — se arquivo destino existe, pergunte "confirmar overwrite?".