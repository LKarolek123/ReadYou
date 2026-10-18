#!/usr/bin/env bash
# Nowy produkcyjny BETTER_AUTH_SECRET: ten sam w Vercelu (API) i na serwerze (worker podpisuje linki
# wypisu). Wartość nie jest wypisywana. Unieważnia istniejące sesje — użytkownicy logują się ponownie.
# Użycie: scripts/rotate-auth-secret.sh [host-ssh]   (wymaga zalinkowanego projektu: VERCEL_ORG_ID/VERCEL_PROJECT_ID)
set -euo pipefail
HOST="${1:-pulsego}"
SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))")"

npx vercel env rm BETTER_AUTH_SECRET production --yes >/dev/null 2>&1 || true
printf '%s' "$SECRET" | npx vercel env add BETTER_AUTH_SECRET production --sensitive >/dev/null 2>&1
printf 'BETTER_AUTH_SECRET=%s\n' "$SECRET" | ssh "$HOST" 'umask 077 && mkdir -p /opt/readyou && cd /opt/readyou \
  && { grep -vE "^BETTER_AUTH_SECRET=" worker.env 2>/dev/null || true; cat; } > worker.env.new && mv worker.env.new worker.env && chmod 600 worker.env'
unset SECRET
echo "BETTER_AUTH_SECRET ustawiony w Vercelu i na $HOST (wymagany redeploy API)"
