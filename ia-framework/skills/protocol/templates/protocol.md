# Protocolo — {NNN}-{slug}

> Anexado automaticamente por `/plan-from-prompt` para auditoria. Nao edite a mao.

## Prompt inicial

```text
"{descrição curta original do usuário}"
```

## Fase A — Perguntas

(preenchido no momento das perguntas; respostas do usuário abaixo)

- A1 (negócio): <pergunta> → <resposta>
- A2 (stack): <pergunta> → <resposta>
...

## Fase B — Critérios de aceite (versão proposta)

- CA-1 [negócio]: ...
- CA-2 [stack]: ...
...

Premissas assumidas (do que ficou ambíguo):
- Premissa-1: <nome> — <razão>.

Critério de aceite `(Aceite/Ajuste/Rejeite)` — usuário respondeu: <resposta>.

## Fase C — Plano

Trilhas a serem abertas:

| NN | slug | stack | depende de | CAs cobertos |
|--- | ---- | ----- | ---------- | ------------- |
| 001 | ... | ... | — | CA-3 |

Fora de escopo explícito:
- <item>

Plano `(Aceite/Ajuste/Rejeite)` — usuário respondeu: <resposta>.

> APROVADO_FASE_C: <timestamp>   <!-- preenchido somente após aprovação explícita -->

## Fase D — Execução

- <trilha>: <verdict do reviewer> (<data>)
- ...

> ABORTADO: <timestamp> <!-- se houver -->