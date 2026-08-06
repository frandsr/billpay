---
type: adr
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay]
---

# 0001 — Next.js full-stack over a separate Go backend and React SPA

## Context
The build budget is roughly six hours of AI-assisted work, and the deliverable is a working product plus a hosted URL a reviewer can open. The evaluation weighs product taste, scope judgment, UX quality, and grasp of the payables workflow — none of which reward a hand-written transport layer.

## Decision
Next.js 15 (App Router) with TypeScript, Prisma, PostgreSQL, Tailwind and shadcn/ui. Mutations run through Server Actions; reads run through React Server Components. There is no separate REST API layer. The project is fully dockerized: `docker compose up` starts both the database and the app.

## Alternatives considered
- **Go + chi + sqlc with a React/Vite SPA served by the Go binary.** Rejected. Two languages, two build pipelines and a hand-written API layer cost roughly 40% more time and buy no credit against the rubric. The Go choice was originally motivated by a personal goal to practise Go, which is not what is being evaluated here.
- **SQLite instead of PostgreSQL.** Rejected. Postgres is the realistic choice for a money product, and Docker reduces the setup cost to near zero, so the simplification buys nothing.
- **A separately hosted frontend talking to a hosted backend.** Rejected. One deployable is faster to run, faster to review, and removes a whole class of CORS/config failure on demo day.

## Consequences
One language end to end, mutations colocated with the UI they serve, and the entire product runs with a single command. Server Actions make server-side enforcement of the bill state machine natural — every mutation is already a server boundary. The trade-off is that there is no explicit API surface to point at, so the domain rules must visibly live in `src/lib` and the server actions rather than being implied by route handlers.
