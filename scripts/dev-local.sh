#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[dev-local] Missing required command: $cmd" >&2
    exit 1
  fi
}

copy_env_if_missing() {
  local src="$1"
  local dst="$2"
  if [[ ! -f "$dst" ]]; then
    cp "$src" "$dst"
    echo "[dev-local] Created $dst from $src"
  fi
}

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
  fi
}

require_cmd npm
require_cmd docker

copy_env_if_missing "apps/server/.env.example" "apps/server/.env"
copy_env_if_missing "apps/web/.env.example" "apps/web/.env.local"

if [[ ! -d node_modules ]]; then
  echo "[dev-local] Installing dependencies..."
  npm install
fi

echo "[dev-local] Starting local dependencies (postgres + redis)..."
docker compose up -d postgres redis

echo "[dev-local] Generating Prisma client..."
npm run prisma:generate --workspace @splendor/server >/dev/null

echo "[dev-local] Syncing database schema..."
(
  set -a
  source apps/server/.env
  set +a
  npm exec --workspace @splendor/server prisma db push --skip-generate >/dev/null
)

trap cleanup INT TERM EXIT

echo "[dev-local] Starting backend on :3001"
npm run dev:server &
SERVER_PID=$!

echo "[dev-local] Starting web on :3000"
npm run dev:web &
WEB_PID=$!

echo "[dev-local] Running. Press Ctrl+C to stop web/server."
wait "$SERVER_PID" "$WEB_PID"
