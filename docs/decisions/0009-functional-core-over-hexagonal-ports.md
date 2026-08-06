---
type: adr
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay]
---

# 0009 — Functional core and imperative shell, not ports and adapters

## Context
The domain has real rules — the state machine of ADR 0002, approval policy matching, line-item reconciliation, split distribution, recurrence dates — and those rules have to be testable without a database. Ports and adapters (hexagonal) is the reflexive answer, and an earlier plan for this project specified it explicitly, with `BillRepository`, `FileStorage` and `OCRProvider` ports.

## Decision
Adopt **functional core, imperative shell** instead. Everything in `src/lib/` is pure domain logic and may not import Prisma, React or `next/*` — the only exceptions are the client singleton `db.ts` and `current-user.ts`, which needs `cookies()`. `src/lib/domain.ts` declares string-literal unions mirroring the schema enums, and `src/server/schema-parity.ts` pins them to Prisma's generated types with type-level assertions so the two cannot drift silently.

Server Actions are the imperative shell: they load data, call the pure core, and persist. There are no repository interfaces and no dependency injection.

## Alternatives considered
- **Full ports and adapters.** Rejected: the testability that motivates hexagonal comes almost entirely from having a pure core, which this design already has. Ports additionally buy the ability to swap the persistence adapter, and Postgres is the only adapter this product will ever have (ADR 0001). Server Actions also have no DI container, so ports would mean hand-threading dependencies through every action or building a service locator — ceremony with no payoff.
- **No layering at all, with domain rules inline in the actions.** Rejected: the rules would be untestable without a database and would drift between call sites.

## Consequences
Domain tests are fast and need no database and no fixtures. The purity rule is mechanically checkable, which matters because several agents work on this codebase in parallel (ADR 0007). The type-level parity guard is the price of not importing Prisma's enums directly; it was verified to fail the build when an enum member is wrong. If a second persistence target ever appeared, introducing ports at that point would be a real refactor — accepted deliberately, since it will not happen here.
