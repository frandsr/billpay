#!/bin/sh
# Applies migrations, conditionally seeds the demo data, then hands over to the
# Next.js standalone server.
#
# Migrations run on EVERY start — that is idempotent by design (`migrate
# deploy` only applies what is missing).
#
# Seeding is NOT idempotent: prisma/seed.ts truncates the domain tables and
# rebuilds them. On a hosted platform every deploy restarts the container, so
# seeding unconditionally would wipe whatever a reviewer created while testing.
# `SEED_ON_START` makes the behaviour explicit:
#
#   auto    (default) seed only when the database is empty
#   always  reseed on every start — destroys existing data, useful for demos
#   never   never seed — for a database whose data must be preserved
set -e

PRISMA="./node_modules/.bin/prisma"
TSX="./node_modules/.bin/tsx"
SEED_ON_START="${SEED_ON_START:-auto}"

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

# Counts rows in a core table. Runs AFTER `migrate deploy`, so the table is
# guaranteed to exist. Prints the count on stdout; non-zero exit on failure.
count_core_rows() {
  node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ log: ["error"] });
prisma.user
  .count()
  .then((count) => {
    console.log(count);
    return prisma.$disconnect();
  })
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
'
}

case "$SEED_ON_START" in
  never)
    echo "==> Seed: SKIPPED (SEED_ON_START=never)"
    ;;
  always)
    echo "==> Seed: RUNNING — forced reseed (SEED_ON_START=always); existing rows will be replaced"
    "$TSX" prisma/seed.ts
    ;;
  auto)
    if ! rows="$(count_core_rows)"; then
      echo "Could not count rows in \"User\" — refusing to guess whether to seed." >&2
      exit 1
    fi
    if [ "$rows" -eq 0 ]; then
      echo "==> Seed: RUNNING — database is empty (0 rows in \"User\", SEED_ON_START=auto)"
      "$TSX" prisma/seed.ts
    else
      echo "==> Seed: SKIPPED — database already populated ($rows rows in \"User\", SEED_ON_START=auto)"
    fi
    ;;
  *)
    echo "Invalid SEED_ON_START=\"$SEED_ON_START\". Expected one of: auto, always, never." >&2
    exit 1
    ;;
esac

# PORT and HOSTNAME are read by the Next.js standalone server (server.js).
# The image defaults them to 3000 / 0.0.0.0; a platform that injects its own
# PORT (Railway does) overrides the image default at runtime. Binding 0.0.0.0
# rather than localhost is what makes the port reachable from outside the
# container.
echo "==> Starting Bill Pay on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec "$@"
