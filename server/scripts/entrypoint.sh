#!/bin/sh
set -e

echo "[entrypoint] syncing database schema..."
npx prisma db push --skip-generate --schema /app/prisma/schema.prisma

node /app/scripts/migrate-word-languages.js
node /app/scripts/migrate-deck-settings.js

echo "[entrypoint] starting flashnext server..."
exec node dist/index.js
