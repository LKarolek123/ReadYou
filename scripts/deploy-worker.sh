#!/usr/bin/env bash
# Wdrożenie workera na serwer: kod z gita (tylko zacommitowane pliki — bez .env), budowa obrazu i restart.
# Użycie: scripts/deploy-worker.sh [host-ssh]   (domyślnie alias `pulsego` z ~/.ssh/config)
set -euo pipefail
HOST="${1:-pulsego}"
DIR=/opt/readyou
cd "$(dirname "$0")/.."

if ! ssh "$HOST" "test -s $DIR/worker.env"; then
  echo "Brak $DIR/worker.env — najpierw: node scripts/push-worker-env.mjs && scripts/rotate-auth-secret.sh" >&2
  exit 1
fi
ssh "$HOST" "rm -rf $DIR/src && mkdir -p $DIR/src"
git archive --format=tar HEAD | ssh "$HOST" "tar -x -C $DIR/src"
ssh "$HOST" "cp $DIR/src/deploy/worker/Dockerfile $DIR/src/Dockerfile && cp $DIR/src/deploy/worker/compose.yml $DIR/compose.yml"
ssh "$HOST" "cd $DIR && docker compose build --pull && docker compose up -d && docker compose ps"
