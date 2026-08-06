# Referência — Prompts scripts por fase

Auxilia o orquestrador do command `/plan-from-prompt` a estruturar saídas claras para o
usuário em cada fase do protocolo.

## Fase A — Bloco de perguntas (template)

```
Para planear "{descrição curta}", preciso confirmar X pontos antes
de gerar spec/plan. Responda o que souber; pule o que não for relevante
para o escopo:

A1. Negócio — quem são os usuários? é MVP ou release completa?
A2. Stack — Backend é Node/Spring/Go? BD é Postgres? auth do zero
   ou integrar SSO existente?
A3. NFRs — há requisito de latência/SLA/compliance relevante?
A4. Telas — há .png em req/screens/? Ou descrição textual no prompt?
A5. Fora de escopo — o que explicitamente NÃO é desta release?
```

Após resposta, normalize:

- Lacuna não respondida → vira premissa declarada (não inferência).
- Lacuna respondida com vago ("se vira") → pergunte de novo de forma mais específica.
- Lacuna respondida com decisão do usuário que muda o escopo → ajuste a descrição e
  recomece a fase A se grandão, ou só refaça a lacuna se pontual.

## Fase B — CAs (template)

```
## Critérios de aceite (versão proposta — aceite/ajuste/rejeite)

- CA-1 [negócio]: Como <papel>, quero <ação>, para <valor>.
                  Critério: <passo-a-passoo verificável>.
- CA-2 [negócio]: Sistema deve <comportamento> quando <condição>.
                  Critério: <verificação>.
- CA-3 [stack]:   POST /api/v1/<recurso> retorna 201 com <shape>.
                  Critério: <test curl/template>.
- CA-4 [NFR]:     /<rota> p95 ≤ <Xms>.
                  Critério: k6 ou trace no APM em release.
- CA-5 [a11y]:   Tela <X> alcança contraste AA em todos os states.
                  Critério: axe-core lighthouse ≥ 90.
...

Premissas assumidas (do que ficou ambíguo):
- Premissa-1: <o que assumi e por quê>.

Aceita, ajusta ou rejeita?
```

Rejeita: aborte com log no `protocol.md`. Ajusta: reapresente a versão final. Aceita:
grave no `protocol.md`.

## Fase C — Plano (template de exibição ao usuário)

```
## Plano (Fase C) — aceite/ajuste/rejeite

Trilhas a serem abertas:

| NN | slug | stack | depende de | CAs cobertos |
|--- | ---- | ----- | ---------- | ------------- |
| 001 | orders-schema | postgres | — | CA-3 |
| 002 | orders-api    | spring   | 001 | CA-3, CA-2 |
| 003 | orders-ui     | angular  | 002 | CA-1, CA-4 |

Fora de escopo (explicitamente):
- Notificações por email (CA referenciado, mas outra release)
- Pesquisa por texto parcial (CA referenciado, mas outra release)

Premissas assumidas:
- Premissa-X: <nome> — <razão de assumir>.

APROVADO_FASE_C: SIM / NÃO / Ajuste?
```

A prova de aprovação: o usuário escreve `SIM` ou `aprovado`Queryable. `"continue"` ou
`"pode ir"` são **vague**: peça confirmação textual explícita.

## Fase D — Início de execução

Após `> APROVADO_FASE_C: <timestamp>` no `protocol.md`:

```
Plano aprovado. Iniciando execução das trilhas. Acompanhe verdicts em
project_sdd/STATUS.md e INDEX.md.

Para cada trilha:
/sdd --stack=<id> feature <slug>

(Após todas) sugira/release:
/tests-release --stack=all
/generate-architecture --stack=all
```

## Aborto / Repro

Se o usuário escrever `NÃO` ou `rejeito`: aborte.

```md
> ABORTADO: 2026-08-05 16:12 UTC — usuário rejeitou fase C
```

Não apague a spec; deixe para revisão futura (e talvez novo prompt com ajustes).

## Ajuste

Se o usuário escrever `ajuste` ou lista de mudanças: ajuste, reexiba (Fase C revisão).
Não precisa recomeçar Fase A a menos que a mudança destrua os CAs.