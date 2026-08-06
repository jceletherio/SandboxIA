# Pre-flight checklist (todos commands SDD)

> Antes de executar qualquer command SDD, verifique o estado mínimo. A intenção do
> template é uso 100% conversacional via orquestrador (opencode ou Claude Code) — o
> usuário nunca deve precisar ir ao terminal. Quando faltar estado, **pergunte**; jamais
> falhe silenciosamente, pois alucinação é garantida sem contexto.

## Invariáveis mínimas

Antes de rodar qualquer command de negócio, verifique:

1. **`ia-framework/STACK.md` configurado** — grep `- \*\*` em seções `## Frontend` /
   `## Backend` / `## Banco de Dados` retorna ≥1 entrada com raiz de código real (não o
   template default). Se só contém o placeholder original → faltando.
2. **`project_sdd/01-context/` existe** — `Test-Path` / `[ -d ]`. Se não → falta `/init`.
3. **`ia-framework/AGENTS.md` existe** — sanity básico de clonagem.

## Comportamento quando faltante

Qualquer invariável faltante → LLM pergunta ao usuário (em uma rodada só):

```
Detectei que o projeto ainda não foi inicializado:
  ✗ ia-framework/STACK.md é o template default (sem stacks ativas)
  ✗ project_sdd/01-context/ ausente

Vou rodar /init agora para você e depois retomar este command — ok?
  [1] Sim, rodar /init e retomar
  [2] Não, abortar — vou rodar /init manualmente depois
```

`[1]` → delega `commands/init.md` (sem re-perguntar tudo; executa e retoma).
`[2]` → abort com mensagem clara: "Rode `/init` primeiro. Depois re-execute este command."

## Pré-voo adicional por command

Commands podem adicionar seu próprio pré-voo específico:

- **`/tests-run` e `/test-add`**: se `vitest.config.ts` / `playwright.config.ts` /
  `pom.xml` sem test deps → sugira `/setup-tooling --deps` antes.
- **`/load-requirements` e `/plan-from-requirements` com `.pdf`**: se `pdftotext` ausente
  → pergunte "instalar pdftotext via `/setup-tooling --pdftotext`? seria útil para
  extrair PDFs."
- **`/generate-architecture`**: se `docs/architecture/` ausente → cria silenciosamente
  (`New-Item`); não bloqueia.
- **`/load-screens`**: se `req/screens/` ausente, pergunta sobre criação + `/req-add`.
- **`/contract-check`**: se não há `01-context/api-context.md` → abort e sugira
  `/generate-architecture` primeiro.

## Não faça

- **Nunca** prossiga sem estado mínimo — alucinação é garantida sem contexto.
- **Nunca** crie estrutura automaticamente sem pedir — ex.: se `project_sdd/` falta,
  pergunte em vez de silenciosamente `mkdir`. Mantém usuário no controle.
- **Nunca** re-passe por perguntas já respondidas — se chained de `/init`, retoma direto.
- **Não** abra `Bash` para operações destrutivas (instalar pacote, mexer lockfile) sem
  confirmação explícita — esse controle fica no `/setup-tooling`, não no pre-flight.

## Ordem típica recomendada para o usuário

1. `/init` — wizard de bootstrap conversacional (pergunta stacks, QMD, hooks).
2. `/req-add <arquivo-fonte>` — adiciona requisitos na pasta `req/`.
3. `/setup-tooling --deps` — instala deps de runtime das stacks ativas.
4. `/plan-from-requirements req/<file>` — gate + plano.
5. `/sdd --stack=<id> <tipo> <slug>` — cada trilha.
6. `/tests-release --stack=all` + `/generate-architecture --stack=all` — snapshot release.