#!/bin/sh
# Applies migrations, seeds the demo data when the database is empty, then
# hands over to the Next.js standalone server.
set -e

PRISMA="./node_modules/.bin/prisma"
TSX="./node_modules/.bin/tsx"

echo "==> Waiting for the database…"
i=0
until node -e "
const net = require('net');
const url = new URL(process.env.DATABASE_URL);
const socket = net.connect(Number(url.port || 5432), url.hostname);
socket.on('connect', () => { socket.end(); process.exit(0); });
socket.on('error', () => process.exit(1));
" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "Database did not become reachable in time." >&2
    exit 1
  fi
  sleep 1
done

# The Prisma client is generated at image build time (see Dockerfile,
# `prod-deps` stage). We run as an unprivileged user and node_modules is
# root-owned, so generating here would fail — and it is wasted work anyway.

echo "==> Applying migrations"
"$PRISMA" migrate deploy --schema=prisma/schema.prisma

echo "==> Seeding demo data (skipped when the database already has rows)"
SEED_IF_EMPTY=1 "$TSX" prisma/seed.ts

echo "==> Starting Bill Pay on port ${PORT:-3000}"
exec "$@"
