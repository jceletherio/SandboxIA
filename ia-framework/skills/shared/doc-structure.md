# Documentação boa o suficiente (multi-stack)

Critério único e verificável: **uma sessão futura, sem nada do seu contexto, retoma o
trabalho sem ler o diff inteiro.** Nem mais, nem menos.

Vale para `01-context/`, para o `02-specs/{NNN}-{slug}/spec.md` da trilha e para o report
final. Especificidades por stack vivem em `skills/stacks/<stack>/references/`.

## TEM que estar escrito

1. **Decisão não óbvia + a razão.** Um parágrafo: o quê, qual alternativa foi descartada,
   por quê. A razão é a parte que não se recupera lendo o código.
2. **Contrato de interface.** Assinatura + tipo do que outra parte consome (função
   exportada, endpoint, formato de evento, shape persistido, signal/component API). Inclua
   comportamento no caminho de erro.
3. **Mapa de onde as coisas estão.** Qual arquivo é dono de qual responsabilidade.
4. **Armadilha conhecida.** Ordem de boot, comando que precisa rodar antes, efeito
   colateral não local. Uma linha basta.
5. **Stack e versão relevante** quando impactar o comportamento (ex.: "Angular 22 zoneless
   — sem `NgZone.run` fora de testes").

## NÃO escreva

- Narrativa de processo. Log de o-que-eu-fiz. Métrica de sessão.
- Código reescrito em prosa — desatualiza no commit seguinte.
- O planejado — só o que existe no código. Backlog vai em `03-decisions/` ou issue tracker.

## Grep-first

Toda referência a código/doc é um **caminho relativo real**, do jeito que se colaria num
`grep`, com a linha quando ajudar:

```
backend/spring/src/main/resources/db/migration/V12__add_tenant.sql:7
frontend/src/app/features/orders/orders.component.ts:42
BD/sql/rls/tenant_policies.sql:11
```

Nada de `[[spec 004]]` ou `RN-07`. Busca semântica é atalho quando existe, nunca
pré-requisito.

## Forma

- Front-matter YAML curto só onde ferramenta o lê (`01-context/` usa).
- Título, seções `##`, conteúdo.
- Ordem: **o que é** → **contrato / como se usa** → **por que assim**.

## Teste rápido antes de salvar

- O leitor acha o arquivo citado com `grep`? Se não, troque a referência.
- Algum parágrafo só conta o que você fez? Apague.
- A decisão não óbvia está lá **com** a razão?
- Dá para cortar metade das linhas sem perder informação? Então corte.