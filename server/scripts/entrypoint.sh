#!/bin/sh
set -e

echo "[entrypoint] syncing database schema..."
npx prisma db push --skip-generate --schema /app/prisma/schema.prisma

echo "[entrypoint] starting flashnext server..."
exec node dist/index.js
