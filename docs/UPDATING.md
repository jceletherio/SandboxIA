# UPDATING — Como receber atualizações do template ia-framework

Este template evolui independentemente dos projetos downstream. Quando você clona como
base e depois melhoreia upstream (você ou o autor), como receber atualizações sem
sobrescrever código de aplicação (`frontend/`, `backend/`, `BD/`) e seus artefatos SDD
(`project_sdd/`, `docs/`)?

## Estratégia recomendada: git subtree

O `ia-framework/` deve residir em **subtree** dentro do projeto downstream. Você pode
receber atualizações do template via `subtree pull`.

### Primeiro uso: incluir template via subtree (em greenfield)

```bash
# adicione remoto do template (será sua propria fork se você mexer nele)
git remote add ia-framework https://github.com/<user>/ia-framework.git

git subtree add --prefix=ia-framework ia-framework main --squash
```

### Receber atualizações

```bash
git subtree pull --prefix=ia-framework ia-framework main --squash
```

Resolve conflitos em:
- `ia-framework/STACK.md` — você ajustou stacks ativas; mantenha suas seleções.
- `ia-framework/AGENTS.md` e `README.md` — normalmente sobrescreva do upstream
  (você não costuma mexer).

### Subir melhorias do template feito no downstream

Se você melhora SKILL/agent/skill/agent/template no projeto e vale compartilhar:

```bash
git subtree push --prefix=ia-framework ia-framework main
```

Ou faça PR no seu fork do template.

## O que se mantém no seu projeto (não upstream)

- `ia-framework/STACK.md` (suas stacks ativas)
- `ia-framework/VERSION` commitado via subtree (mas se divergir, marque local)
- `project_sdd/`, `docs/architecture/`, `docs/testing/` (seu conteúdo)
- `frontend/`, `backend/`, `BD/` (código de aplicação)
- `req/` (seus requisitos)
- `README.md`, `AGENTS.md` raiz — você pode personalizar
- `.pre-commit-config.yaml` (copiado de `.template` no seu setup)

## Versões e tags

- `ia-framework/VERSION` — semver do template. Atual da última subtree pull.
- `ia-framework/CHANGELOG.md` — histórico. Compare com seu `VERSION` local para decidir
  urgency do pull.

Esquema de breaking changes:
- **MAJOR**: remove/rename command ou agent; você precisa ajustar plano aberto.
- **MINOR**: adiciona agent/skill/command; pullamento é seguro.
- **PATCH**: ajuste de padrão; safe.

## Quando NÃO atualizar subtree

- Em middle de release candidate: lockiao o template até o merge. Atualizar SDD em
  middle de trilha pode introduzir mudança de behavior do implementador/reviewer.
- Sempre rode `init.ps1` (ou `init.sh`) após subtree pull maior — wizard detecta novas
  pastas e as cria.

## Fallback: copy-paste manual (raro)

Se você não quer subtree (ex.: repo monorepo com várias libs, subtree fica confuso):
- Copie arquivos novos de release para `ia-framework/`.
- Edite apenas arquivos que você não alterou downstream (se você mexeu em
  `agents/<stack>-implementador.md` e upstream o atualizou, mergulhe manualmente).

## Tag de release downstream

Para rastreabilidade, marque tag com `ia-framework-<VERSION>` no seu repo downstream:

```bash
git tag -a ia-framework-1.0.0 -m "Puxado ia-framework 1.0.0"
git push origin ia-framework-1.0.0
```

Assim em produção você consegue `git tag --list 'ia-framework-*'` para ver qual release
está em cada commit SHA.