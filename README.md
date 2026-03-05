# Splendor Duel Online

Monorepo implementation for a remote multiplayer MVP of `Splendor Duel`, with:

- Web H5 client (`apps/web`, Next.js + React + Zustand)
- Realtime server (`apps/server`, NestJS + Socket.IO)
- Shared protocol/types (`packages/shared`)
- Server-authoritative game engine (`packages/engine`)

## Workspace Layout

- `apps/web`: H5 UI pages (`/`, `/room/[code]`, `/match/[id]`, `/history`)
- `apps/server`: REST + WS backend
- `packages/shared`: protocol schema, card data, constants
- `packages/engine`: deterministic rules engine and state machine

## API Summary

- `POST /api/v1/auth/guest`
- `POST /api/v1/rooms`
- `POST /api/v1/rooms/:roomCode/join`
- `GET /api/v1/matches/:matchId`
- `GET /api/v1/me/history?cursor=...`

WS namespace: `/ws/game`

- Client events: `room.subscribe`, `room.ready`, `match.action`, `match.resign`, `match.sync`
- Server events: `room.state`, `match.snapshot`, `match.event`, `match.error`, `match.finished`

## Run (after installing dependencies)

```bash
npm install
npm run dev:server
npm run dev:web
```

Server defaults to `http://localhost:3001`, web defaults to `http://localhost:3000`.

## One-Command Local Run

```bash
npm run dev:local
```

This script will:

- create `apps/server/.env` from `apps/server/.env.example` if missing
- create `apps/web/.env.local` from `apps/web/.env.example` if missing
- start local `postgres` and `redis` via Docker Compose
- generate Prisma client and push schema
- start backend (`:3001`) and web (`:3000`)

## Docker

```bash
docker compose up --build
```
