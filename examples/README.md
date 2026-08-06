# examples/

Exemplos resolvidos de uso do template `ia-framework`. Consulte como exercício de
referência — não é gerado automaticamente por algum command; foi escrito à mão para
demonstrar o fluxo SDD Enxuto num caso real.

## petshop/

MVP de petshop com:

- Cadastro de produtos (backend Spring + BD Postgres)
- Checkout (backend Spring + BD Postgres)
- Tela de pedidos (frontend Angular)

### Árvore esperada

```
petshop/
  requisito.md                                 # entrada do usuário (.md curto)
  req/screens/orders-list.png.placeholder.md  # como anexar PNG real
  project_sdd/
    INDEX.md                                   # exemplo de índice token-efficient
    01-context/
      requirements.md                          # saída esperada do requirements-reader
      screens/S-001-orders-list.md            # saída esperada do screens-reader
      plan.md                                  # saída esperada do sdd-planner
    02-specs/
      001-products-schema/spec.md              # trilha Postgres
      002-products-api/spec.md                # trilha Spring
      003-orders-ui/spec.md                    # trilha Angular (referencia tela S-001)
  docs/
    architecture/overview.md                  # snapshot por /generate-architecture
    testing/test-plan-frontend-angular.md      # snapshot por /tests-release
```

### Como navegar

1. Leia `requisito.md` para entender o pedido original.
2. Veja `project_sdd/01-context/requirements.md` — saída esperada do
   `requirements-reader`.
3. Veja `project_sdd/01-context/screens/S-001-orders-list.md` — saída esperada do
   `screens-reader` (presumo anexo PNG no prompt).
4. Veja `project_sdd/01-context/plan.md` — saída esperada do `sdd-planner` (3 trilhas
   com dependências).
5. Veja `project_sdd/02-specs/001-products-schema/spec.md` — exemplo de spec de BD.
6. Veja `project_sdd/02-specs/002-products-api/spec.md` — exemplo de spec de backend.
7. Veja `project_sdd/02-specs/003-orders-ui/spec.md` — exemplo de spec Angular que
   referencia tela `S-001` no "Comportamento alvo".
8. `project_sdd/INDEX.md` — índice token-efficient (~500 tokens) que agentes consultam
   antes de mergulhar.
9. `docs/architecture/overview.md` — snapshot gerado por `/generate-architecture
   --stack=all`.
10. `docs/testing/test-plan-frontend-angular.md` — plano gerado por `/tests-release
    --stack=angular`.

### Não incluído no exemplo

- Código de produção (`frontend/`, `backend/spring/`, `BD/sql/`) — o template gera plano,
  não código.
- `protocol.md` de `/plan-from-prompt` — petshop usou `/plan-from-requirements`.
- ADRs (`03-decisions/ADR-*.md`) — exemplos de arquitetura não tomaram decisão irreversível.