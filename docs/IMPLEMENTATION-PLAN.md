---
type: implementation-plan
domain: ramp-bill-pay
tags: [plan, ramp-bill-pay]
---

# Implementation plan — Bill Pay

Read with [[GLOSSARY]] (authoritative vocabulary), [[ARCHITECTURE]] (schema,
shared libraries, ownership map) and [[decisions/README]] (ADRs 0001–0010). Where
this plan and the glossary disagree, the glossary wins.

Budget: roughly six hours of AI-assisted build. Branch `main`.

> **This document reflects the scope after the mid-build pivot of ADR 0008.**
> An earlier revision listed the AP aging report as in scope and invoice OCR as
> deferred. Both are now the other way round. Anything describing three verticals
> or an `aging` route predates the pivot.

## 1. Product summary

Bill Pay is an accounts-payable product for a mid-size finance team: a bill
arrives, gets coded to the general ledger, gets approved by the right people in
the right order, gets paid, and leaves a record of who did what. Inspired by Ramp
Bill Pay and deliberately narrower — one currency, one payment per bill — but the
loop it implements is complete rather than sampled.

That loop is **intake → GL coding → multi-step approval → payment → audit
trail**. It is surfaced through five navigation entries: **Dashboard** (what
needs attention today), **Bills** (the work queue, split by lifecycle stage),
**Import** (CSV and scanned invoices), **Recurring** (templates that generate
bills on a schedule) and **Vendors** (payment readiness and default terms).
Identity comes from a seeded user switcher instead of authentication (ADR 0006),
so a reviewer can walk one bill through a two-step approval chain in under a
minute.

## 2. Architecture principles

- **Functional core, imperative shell** (ADR 0009). Everything in `src/lib/` is
  pure domain logic and must never import Prisma, React or `next/*` — the only
  exceptions are `db.ts` (the client singleton) and `current-user.ts` (needs
  `cookies()`). Server Actions are the imperative shell: load, call the core,
  persist, revalidate. Deliberately *not* ports and adapters — the testability
  win comes from the pure core, repository ports would only buy a database swap
  that will never happen, and Server Actions have no DI container.
- **The state machine is enforced server-side, never by the UI.** Every status
  write calls `assertTransition(from, to)` from `src/lib/bill-status.ts`, and
  every payment status write calls `assertPaymentTransition`. The UI derives its
  buttons from the same tables, so the two cannot drift.
- **Money is always integer minor units.** `Int` cents everywhere — database,
  form state, component props. Percentages are basis points. No floats.
- **Single-writer file ownership** (ADR 0007): a vertical writes only files in
  its own column of the [[ARCHITECTURE]] §5 map.
- **Deferred features are additive** (ADR 0005): a new feature is a new file and
  at most a nullable column, never an edit to someone else's file.

## 3. Build phases

| Phase | Mode | Scope | Status |
| --- | --- | --- | --- |
| **0 — Foundation** | Sequential, on `main` | Docker, Prisma schema + seed, app shell, shared pure libs, page skeletons, component stubs with fixed props | Done |
| **1 — Verticals A–E** | Parallel, one git worktree each | Inbox · Bill detail · Approval + payment · Ingestion · Recurring | Done |
| **2 — Integration** | Sequential | Merge, dashboard, vendors, domain tests, deploy | Done |
| **3 — Consolidation** | Sequential | Move stranded pure modules into the core, de-duplicate, role gates, docs | Done |

### Phase 0 — Foundation

One agent on `main`. Shipped the Prisma schema with the seams ADR 0005 requires,
deterministic seed data (46 bills across every status and aging bucket, with
generated invoice PDFs rendered from the *same* numbers), the app shell with
sidebar nav and user switcher, the pure libs (`money`, `dates`, `bill-status`,
`approval-policy`, `domain`, `current-user`, `db`), the shared reads
(`src/server/bill-detail.ts`, `src/server/reference-data.ts`), and every feature
component as a **stub in its own file** with its props contract fixed by the page
that renders it.

The rule that made the parallelism work: **do not change a stub signature.** A
wrong contract forces a cross-agent edit, which the design forbids. Several stubs
take no props at all and read their own data server-side — a contract with no
arguments cannot be the wrong contract.

### Phase 0.5 — The pivot migration

ADR 0008 landed between the foundation and the verticals. Invoice OCR, CSV
import, line-item splits and recurring bills moved into scope; the AP aging
report and inbox bulk actions were cut to pay for them.

This was one sequential migration pass: six new tables (`LineItemSplit`,
`AllocationTemplate`, `AllocationTemplateSplit`, `RecurringBill`,
`RecurringBillLineItem`, `OcrExtraction`), one new enum member
(`BillSource.RECURRING`), one nullable column (`Bill.recurringBillId`) and **no
change to an existing column**. `billDetailInclude` was widened once, here, to
carry the new relations — so no vertical ever needed to touch the shared query.

That the pivot cost a migration pass rather than a rewrite is the only real
evidence that the ADR 0005 seams were more than a paragraph.

### Phase 1 — Feature verticals (parallel)

Five agents, one git worktree each. Frozen for everyone: `src/lib/**`,
`src/server/bill-detail.ts`, `src/server/reference-data.ts`,
`src/components/ui|common|shell/**`, both layouts,
`src/app/(app)/bills/[id]/page.tsx`, `prisma/**` and the Docker files. New server
actions go in `src/server/actions/<vertical>.ts`; new pure helpers in
`src/lib/<feature>.ts`.

| | Vertical | Shipped |
| --- | --- | --- |
| **A** | Bills inbox + manual creation | Tabs **Drafts / Awaiting approval / Approved / Rejected / History / All**, with status, vendor, due-date and amount filters plus sorting, all driven by URL `searchParams` so the list stays a Server Component. Drafts additionally show `Missing info` / `Ready` from `draftReadiness`. "New bill" derives the due date via `dueDateFrom` and creates a `DRAFT` with a `CREATED` activity. Bulk actions **not** built (cut by ADR 0008). |
| **B** | Bill detail | Invoice document beside the coding surface. Line-item editor adds, edits, reorders and deletes lines, assigns GL account and department, and shows reconciliation live — coded total, bill total, signed difference. Per-line splits by percentage or fixed amount, with saved allocation templates. Activity feed with comments. Only `DRAFT` and `REJECTED` bills are editable, enforced in the action. |
| **C** | Approval + payment | Submit matches the first applicable policy by `priority` ASC where `minAmountCents ≤ totalCents` and **snapshots** its approvers as `ApprovalStep` rows. Panel shows "X of N" and whose turn it is. Approve/reject is available only to the current step's approver, checked server-side. Payment picks a method and a scheduled date, then moves `SCHEDULED → INITIATED → PAID \| FAILED` on its own lifecycle. A vendor with no payment details refuses each rail **by name**. |
| **D** | Ingestion | Invoice upload → Gemini extraction constrained to a JSON schema, cascading `gemini-3.1-flash-lite` → `gemini-2.5-flash` → a deterministic mock, so the build never depends on a secret. The run is persisted as an `OcrExtraction` and the bill lands as a `DRAFT` for review (ADR 0010). CSV import parses quoted fields, CRLF and BOM, treats a **row as a line item** so rows sharing (vendor, bill number) collapse into one bill, and validates every row before anything is written. |
| **E** | Recurring | Templates with their own coded line rows. Generating writes `DRAFT` bills with `recurringBillId` set, `source = RECURRING` and the template's lines copied in, then advances `nextRunDate` via `nextRunDateAfter`. `dueOccurrences` returns **all** owed occurrences, because generating only the newest silently loses the rest. |

### Phase 2 — Integration

Merged the five worktrees — a merge, not a reconciliation, because the
foundation-owned files were untouched. Then built the aggregation views, which
can only exist once the verticals produce data:

- **Dashboard**: outstanding payables, the current user's approval queue, drafts
  blocked on missing info, upcoming payments, recent activity, and the aging
  strip — a single segmented bar that is what survives of the cut aging report.
  It reads `agingBucket()` from the shared core, so the strip and any future
  report classify identically.
- **Vendors**: suppliers ordered by whether they can actually be paid, with the
  blocked rail named. Readiness delegates to `missingVendorPaymentDetails`, the
  same rule the payment action enforces, so the list cannot call a vendor payable
  that the action would refuse.

Then Vitest, the domain tests, the README and the Railway deploy.

### Phase 3 — Consolidation

A sequential pass after the merges, correcting what parallel work had left
crooked:

- Pure domain modules stranded in component directories moved into the core:
  `approval-chain.ts` and `payment-lifecycle.ts` to `src/lib/`, the recurring
  reads to `src/server/queries/recurring.ts`.
- `ActionResult`, declared twice, given a single home in
  `src/lib/action-result.ts`.
- "Outstanding" defined once in `src/lib/outstanding.ts` and each reading named,
  rather than re-derived per query.
- Role gates for payment execution and bill reopening in `src/lib/permissions.ts`.
- A rejected-bills tab, a discoverable entry point for the splits editor, a seed
  vendor that cannot be paid, and the invoice upload limit raised to 8 MB.
- [[ARCHITECTURE]] corrected where the merges had made it false.

## 4. Testing scope

Unit tests against the pure core only — no database, no rendering, no
`prisma generate`, fast enough to run on every save. **138 tests across 6 files.**

| File | What is asserted |
| --- | --- |
| `bill-status.test.ts` (43) | Every legal transition; every illegal one throws `InvalidBillTransitionError`, including the `REJECTED → DRAFT` re-edit path and the terminality of `PAID` / `ARCHIVED`. Plus readiness: Σ(lines) vs `totalCents`, and the `Missing info` / `Ready` derivation including no-lines, uncoded-line and coded-by-splits cases |
| `splits.test.ts` (28) | `distributeByBasisPoints` conserves cents by largest remainder; template application; `validateSplits` issue codes; Σ(splits) == line amount |
| `dates.test.ts` (24) | `dueDateFrom` for each `PaymentTerms` member; `agingBucket` at every boundary (0, 1, 30, 31, 60, 61, 90, 91) |
| `bill-filters.test.ts` (18) | Search-param parsing and re-serialisation: tab resolution, repeated params, default sort per tab |
| `permissions.test.ts` (14) | Role gates for payment execution and bill reopening, and the refusal messages |
| `outstanding.test.ts` (11) | Which statuses count as outstanding, unpaid-including-drafts and due-date-relevant |

Explicitly out of scope: end-to-end and component tests. Inside a six-hour budget
they cost more than they prove, and the logic worth protecting is all in the core.
`pnpm typecheck` covers the rest — including `src/server/schema-parity.ts`, which
fails the build if the core's enums drift from `prisma/schema.prisma`.

## 5. Deployment

Railway, running the existing multi-stage `Dockerfile` against a managed
Postgres. Chosen because it runs *the same container* as local development — a
serverless target would split the hosted environment from `docker compose up` and
leave the reviewer two different products to trust.

The container waits for the database, applies migrations with
`prisma migrate deploy`, and seeds according to `SEED_ON_START` (`auto` by
default: only when the database is empty, so a redeploy does not wipe what a
reviewer created). `/api/health` reports database connectivity and latency.

Live: https://billpay-production-e277.up.railway.app

## 6. Definition of done

- [x] `docker compose up --build` works from a clean clone with no manual steps.
- [x] Seed produces realistic data across every bill status, every payment
      status, all five aging buckets, and four `Missing info` drafts blocked for
      four different reasons.
- [x] The full loop is demonstrable end to end: create → code → submit → approve
      through a **multi-step** chain (switching users) → schedule payment → mark
      paid, with the activity feed showing the correct actor at each step.
- [x] Bills also enter by OCR upload, CSV import and recurring generation, and
      all three land as reviewable drafts through the same rules.
- [x] Illegal transitions are provably blocked server-side, not merely hidden.
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` all pass.
- [x] README covers the five required sections.
- [x] Hosted URL is live and reachable, running the same seed.

## 7. Deferred features and their seams

Post-pivot cut line. Each is reachable by a purely additive migration; see
[[ARCHITECTURE]] §3 for the detail.

| Feature | Why deferred | Seam that makes it additive |
| --- | --- | --- |
| AP aging report | Cut to pay for ingestion (ADR 0008). Pure reporting | `agingBucket()` / `AGING_BUCKETS` are implemented and tested; `dueDate`, `status` and the payment rows carry everything the buckets need. A query and a table, no migration |
| Inbox bulk actions | Cut in the same trade. Throughput, not correctness | Inbox filtering is already pure and URL-driven; a bulk action is a new server action over the same selector |
| AP email forwarding | Needs an inbound mail rail we do not have | `Bill.source = EMAIL`; same ingestion path OCR and CSV already use |
| Partial payments | Doubles the payment state to track | `Bill → Payment` is already 1:N with its own `amountCents`; the single-payment rule lives in the action, not the schema |
| Multi-currency | FX is a reporting feature, not an AP one | `Bill.currency` is written on every row; add nullable `fxRateBp` / `baseAmountCents` + an `FxRate` table. `money.ts` already keys precision off the currency code |
| Duplicate detection | Needs fuzzy-match UX to be useful | `@@unique([vendorId, billNumber])` blocks the exact case; fuzzy scoring is a pure function over an indexed query |
| 1099 tracking | Year-end reporting, outside the loop | `Vendor.is1099` and `Vendor.taxId` exist; the report is a read-only aggregation |
| Accounting sync | Depends on an external system contract | `GlAccount.code` is already the external chart-of-accounts code; add an `ExternalRef` table, no column changes |
| Real payment rails | Out of scope for a take-home | The `Payment` lifecycle is already modelled and enforced; only the rail is simulated |
| Authentication | Demonstrates nothing about payables (ADR 0006) | `getCurrentUser()` is one function reading a cookie; swapping it for a session touches nothing else |
