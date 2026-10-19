# Worker ReadYou (kolejka zadań, embeddingi e5 na CPU, streszczenia). API i front działają na Vercelu.
# Obraz budowany na serwerze z `git archive` (scripts/deploy-worker.sh) — bez sekretów w obrazie;
# zmienne środowiskowe przychodzą z /opt/readyou/worker.env (compose `env_file`).
FROM node:22-bookworm-slim

WORKDIR /app
# ONNXRUNTIME_NODE_INSTALL=skip: bez pobierania bibliotek CUDA z NuGet (brak GPU; wersja CPU jest w paczce npm).
ENV NODE_ENV=production \
    EMBEDDING_CACHE_DIR=/cache/models \
    ONNXRUNTIME_NODE_INSTALL=skip

COPY . .
# devDependencies też (tsx uruchamia TypeScript bez osobnego kroku budowania).
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force \
  && mkdir -p /cache/models && chown node:node /cache/models

USER node
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/worker.ts"]
