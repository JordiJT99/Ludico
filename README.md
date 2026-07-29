# Lúdico

Plataforma diaria de quiz y crucigramas. La especificación aprobada está en [`docs/`](docs/README.md).

## Requisitos

- Node.js 24 LTS
- pnpm 11.9
- Docker con PostgreSQL 18 para integración local

## Arranque

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm dev
```

Web: `http://localhost:3000`. API: `http://localhost:4000/health`.

## Verificación

```bash
pnpm check
```

Los secretos nunca se guardan en el repositorio. IA y publicidad están deshabilitadas por defecto.
