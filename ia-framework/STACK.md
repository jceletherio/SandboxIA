---
purpose: Manifesto de stacks ativas neste monorepo. Lido pelos agentes/commands da ia-framework para selecionar a skill correta quando o chamador nao explicita a stack.
updated: 2026-08-05
---

# Manifesto de Stacks

## Frontend

- **angular** - Angular 22 (standalone, signals, novo control flow, zoneless)
  - Raiz do codigo: `frontend/`
  - Skill: `skills/stacks/angular/SKILL.md`

## Backend (escolha um ou mais)

- **nodejs** - Node.js 22+ (ESM, Fastify/Express5/NestJS)
  - Raiz do codigo: `backend/nodejs/`
  - Skill: `skills/stacks/nodejs/SKILL.md`

- **go** - Go 1.23+ (modulos, context-first, interfaces no consumer-side)
  - Raiz do codigo: `backend/go/`
  - Skill: `skills/stacks/go/SKILL.md`

## Banco de Dados

## Convecoes

- Stack ausente neste manifesto = agente recusa a tarefa e pede para o usuario escolher.
- Mais de uma stack de backend ativa e valido - cada agente fica restrito a sua raiz.
- Quando o chamador passa `--stack=<id>` num comando, esta lista e ignorada para aquela
  invocacao (escolha explicita vence inferencia).

