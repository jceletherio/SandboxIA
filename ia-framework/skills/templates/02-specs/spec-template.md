# Spec — {NNN}-{slug}

> Trilha SDD. **Um arquivo.** Quatro seções na ordem. Critério de escrita em
> `skills/shared/doc-structure.md`. Preencha no lugar dos placeholders.

**Variante:** feature | bug-fix | investigation | doc-update
**Stack:** angular | react | nodejs | spring | go | postgres | multi
**Slug:** {slug}

## Comportamento alvo

O que muda para quem usa. 5–8 bullets em efeito observável, não implementação.

- [ ] <bullet>
- [ ] <bullet>

## Contratos tocados

Assinatura nova/alterada com tipo. Inclua caminho de erro. Referência real (arquivo:linha
quando já existir).

```ts
// exemplo Angular
export interface OrdersListVm { items: OrderVm[]; loading: boolean; error: string | null }
```

```http
GET /api/v1/orders?status=open → 200 { items: [...] } | 401 | 403
```

## Tarefas

Ordenadas, executáveis, cada uma com arquivo alvo. Paralelo só entre arquivos disjuntos.

1. [ ] src/backend/<stack>: <tarefa> — `arquivo-alvo`
2. [ ] frontend: <tarefa> — `arquivo-alvo`
3. [ ] BD: <tarefa> — `arquivo-alvo`
4. [ ] testes: <tarefa>

## Fora de escopo

- <item explicitamente excluído — impede a fase 3 de crescer sozinha>

## Premissas assumidas

(pergunta sem resposta vira premissa nomeada, nunca `[PENDENTE]`)

- <premissa>: <razão de assumir>.

## Notas de review

- <deixar em branco; preenchido pelo reviewer na fase 4>