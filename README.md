# Bill Pay

Accounts payable for a mid-size company: capture a bill, code it to the general
ledger, route it through an approval chain, schedule the payment and watch the
AP aging. Built as a take-home challenge inspired by Ramp Bill Pay.

## Run it

```bash
docker compose up --build
```

That is the whole setup. It starts Postgres 16, waits for it to be healthy,
applies the migrations, seeds the demo data and serves the app on
**http://localhost:3000**.

Re-running `docker compose up` keeps whatever you did in the UI — the seed only
runs when the database is empty. To start over:

```bash
docker compose down -v && docker compose up --build
```

## Local development

```bash
cp .env.example .env
docker compose up -d db       # Postgres only
pnpm install
pnpm db:migrate               # create + apply migrations
pnpm db:seed                  # load the demo data
pnpm dev                      # http://localhost:3000
```

Requires Node 20+ and pnpm 10 (npm works too).

### Useful scripts

| Command | Does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | `prisma generate` + production build |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |
| `pnpm db:migrate` / `pnpm db:deploy` | Create+apply / apply migrations |
| `pnpm db:seed` | Reseed (destructive — truncates and rebuilds) |
| `pnpm db:reset` | Drop, re-migrate and reseed |
| `pnpm db:studio` | Prisma Studio |
| `pnpm invoices:generate` | Re-render the placeholder invoice PDFs |

## Demoing it

There is no login. The top-right **user switcher** picks who you are acting as —
that is how you walk a bill through a two-step approval chain on your own.

| User | Title | Role |
| --- | --- | --- |
| Maya Chen | AP Clerk | Member *(default)* |
| Daniel Okafor | Controller | Approver |
| Priya Raman | Chief Financial Officer | Approver |
| Alex Whitfield | Head of Operations | Approver |
| Sofia Delgado | Workplace Manager | Member |
| Tom Bergstrom | IT & Systems Admin | Admin |

Approval policies: under $1,000 auto-approves, $1,000+ needs the Controller,
$10,000+ needs the Controller and then the CFO.

The seed loads 45 bills across every status, with drafts that are deliberately
incomplete, payments in all four payment states, and outstanding balances in
every AP aging bucket.

## Documentation

- [`docs/GLOSSARY.md`](docs/GLOSSARY.md) — the authoritative domain vocabulary.
  A *Bill* is the payable record; an *Invoice* is the attached document. Bills
  are *Awaiting approval*, never "pending", and *Archived*, never "deleted".
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data model, the bill state
  machine, why the roadmap features are additive migrations, the shared library
  surface and the file ownership map.

## Stack

Next.js 15 (App Router, React Server Components, Server Actions) · TypeScript ·
Tailwind CSS v4 · shadcn/ui · Prisma · PostgreSQL 16 · Docker Compose.

Money is always an integer number of cents. Never a float.
