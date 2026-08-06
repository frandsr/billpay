---
type: architecture
domain: ramp-bill-pay
tags: [architecture, ramp-bill-pay]
---

# Architecture — Bill Pay

Companion to [[GLOSSARY]], which is the authoritative domain vocabulary. Where
this document and the glossary disagree, the glossary wins.

---

## 1. Stack and shape

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 15, App Router, `src/` | Server Components read, Server Actions write — no REST layer to keep in sync |
| Language | TypeScript, strict | The domain is money; the compiler is the cheapest reviewer |
| Styling | Tailwind CSS v4 + shadcn/ui (neutral) | Dense, professional finance UI without a component-library dependency we cannot edit |
| Data | Prisma + PostgreSQL 16 | Relational, migration-first, and the aging/report queries are naturally SQL |
| Mutations | Server Actions | Colocated with the UI, typed end to end, no client fetch layer |
| Runtime | Docker Compose (`db` + `app`) | `docker compose up --build` is the whole setup story |

There is **no authentication**. The reviewer picks an identity from the top-bar
user switcher, which writes a cookie read by `getCurrentUser()`. That is how a
single person walks a bill through a two-step approval chain.

---

## 2. Domain model

Money is **always** an `Int` in minor units (cents). No floats, anywhere —
not in the database, not in component state, not in form values. Currency lives
on the Bill.

### Entities

| Entity | Key fields |
| --- | --- |
| `User` | `name`, `email`, `title`, `role` (ADMIN/APPROVER/MEMBER), `initials`, `avatarColor` |
| `Vendor` | `name`, `email`, address, `bankName`/`accountLast4`/`routingLast4` (demo only), `defaultPaymentTerms`, `defaultGlAccountId?`, `taxId?`, `is1099`, `status` |
| `GlAccount` | `code` ("6100"), `name` ("Software & Subscriptions"), `type`, `active` |
| `Bill` | `billNumber`, `vendorId`, `issueDate`, `dueDate`, `paymentTerms`, **`totalCents`**, `currency`, `memo?`, `status`, `source`, `invoiceFileUrl?`, `invoiceFileName?`, `createdById`, `submittedAt?`, `approvedAt?` |
| `LineItem` | `billId`, `description`, `quantity`, `unitPriceCents`, `amountCents`, `glAccountId?`, `department?`, `lineType`, `sortOrder` |
| `Payment` | `billId`, `amountCents`, `method`, `scheduledDate`, `initiatedAt?`, `completedAt?`, `status`, `reference?` |
| `ApprovalPolicy` | `name`, `priority`, `minAmountCents`, `active` + `ApprovalPolicyStep(stepOrder, approverId)` |
| `ApprovalStep` | `billId`, `stepOrder`, `approverId`, `status`, `decidedAt?`, `note?` |
| `Activity` | `billId`, `userId?`, `type`, `message`, `createdAt` |

### Three invariants worth stating out loud

1. **`Bill.totalCents` is authoritative.** Line items are coding detail. When
   Σ(line items) ≠ `totalCents`, the bill is *not* silently corrected — it
   surfaces as `Missing info`. Accountants care about the difference; hiding it
   would be the bug.
2. **`Payment` is a separate entity with its own lifecycle.** There is no
   `SCHEDULED` bill status. A scheduled payment is an `APPROVED` bill that owns
   a `Payment` in status `SCHEDULED`. The relation is already 1:N, so partial
   payments are additive.
3. **`Missing info` / `Ready` are derived, never stored.** They are computed by
   `draftReadinessDetail()` from the bill and its line items. Storing them would
   create a cache to invalidate on every edit.

### Bill lifecycle

```
DRAFT ──────────► AWAITING_APPROVAL ──────────► APPROVED ──────────► PAID
  │                      │    │                     │
  │                      │    └──► REJECTED ──┐     │
  │                      │                    │     │
  └──────────────────────┴────────────────────┴─────┴──────► ARCHIVED
                                     │
                          REJECTED ──┘ (back to DRAFT)
```

`PAID` and `ARCHIVED` are terminal. The table lives in
`src/lib/bill-status.ts` as data (`BILL_TRANSITIONS`); the UI derives which
buttons to show from it, and **every server action must call
`assertTransition(from, to)` before writing a status**. UI and server therefore
cannot drift.

### Approval policy resolution

Among `active` policies, evaluate by `priority` ASC and take the **first** whose
`minAmountCents` ≤ `bill.totalCents`. A policy with zero steps means
auto-approve. Implemented once as a pure function in
`src/lib/approval-policy.ts` and used by the seed, the server actions and the
UI preview, so they cannot disagree.

Seeded policies:

| Priority | Policy | Threshold | Chain |
| --- | --- | --- | --- |
| 10 | Executive approval | ≥ $10,000 | Controller → CFO |
| 20 | Controller approval | ≥ $1,000 | Controller |
| 30 | Auto-approve under $1,000 | ≥ $0 | *(none)* |

---

## 3. Roadmap readiness — why each of these is an ADDITIVE migration

The point of the schema below is that none of the following requires a
destructive change: no column drops, no type changes, no data backfill that
rewrites existing rows.

### Line-item splits + allocation templates

`LineItem.amountCents` is the line's total and `glAccountId` is nullable.
A split is a **child** of a line, so it arrives as a new table:

```prisma
model LineItemSplit {
  id          String  @id @default(cuid())
  lineItemId  String
  glAccountId String
  department  String?
  amountCents Int      // Σ(splits) == LineItem.amountCents
  percentBp   Int?     // optional basis points, for percentage splits
}
```

Existing rows stay valid: a line with no splits is a line coded entirely to its
own `glAccountId`. An `AllocationTemplate` + `AllocationTemplateLine` pair is
the same shape without a `lineItemId` — templates and splits never share a
table, exactly as the glossary distinguishes them.

### Recurring bills

A recurring bill is a *generator*, not a bill. It arrives as a new
`RecurringBillTemplate` (vendor, cadence, day-of-month, line template, next run)
plus **one nullable column** on `Bill`:

```prisma
recurringTemplateId String?
```

Every existing bill keeps `NULL`. Nothing about the lifecycle changes — the
generator simply creates DRAFT bills on a schedule.

### OCR / CSV / email ingestion

`Bill.source` is already a `BillSource` enum with `MANUAL | OCR | CSV | EMAIL`,
and `invoiceFileUrl` / `invoiceFileName` already hold the document. The seed
already produces OCR/CSV/EMAIL drafts, including one whose extracted lines do
not match the scanned total. Real ingestion adds an `IngestionJob` table
(payload, status, extracted-field confidence) that *writes* bills through the
same path the manual form uses. No `Bill` column changes.

Nullable extraction confidences would attach to a sibling table
(`BillFieldExtraction`) rather than widening `Bill`, keeping the payable record
free of pipeline metadata.

### Partial payments

`Payment` is already a 1:N child of `Bill` and already carries its own
`amountCents` and status. The app currently enforces "one payment for the full
amount" in the **server action**, not in the schema. Removing that rule is a
code change, not a migration. `Bill.status = PAID` becomes
`Σ(payments where status = PAID) >= totalCents`, and a `PARTIALLY_PAID` derived
flag can be computed the same way `Missing info` is today.

### Multi-currency

`Bill.currency` already exists and is written on every row. Adding
presentation-currency reporting means two nullable columns
(`fxRateBp Int?`, `baseAmountCents Int?`) plus an `FxRate` table — all additive,
and `src/lib/money.ts` already keys minor-unit precision off the currency code
(`minorUnitDigits`), so zero-decimal currencies work without touching call
sites.

---

## 4. Shared libraries (owned by the foundation phase — import, do not edit)

**`src/lib/` is the functional core and is kept PURE**: no file in it may import
Prisma, React or `next/*`. The only two exceptions are `db.ts` (the client
singleton) and `current-user.ts` (which needs `cookies()`). That is why the
domain enums are declared as string-literal unions in `src/lib/domain.ts`
instead of being imported from the generated client — the domain tests then run
with no database, no `prisma generate` and no DOM. `src/server/schema-parity.ts`
pins those unions to `prisma/schema.prisma` with type-level assertions, so
adding a status to the schema and forgetting the core fails `pnpm typecheck`.

| Module | Exports |
| --- | --- |
| `src/lib/domain.ts` | `BillStatus`, `PaymentStatus`, `PaymentMethod`, `PaymentTerms`, `ApprovalStepStatus` + the matching `BILL_STATUSES`-style const arrays |
| `src/lib/db.ts` | `db` / `prisma` — Prisma client singleton |
| `src/lib/money.ts` | `formatCents`, `parseAmountToCents`, `sumCents`, `lineAmountCents`, `dollars`, `minorUnitDigits` |
| `src/lib/dates.ts` | `dueDateFrom`, `daysOverdue`, `daysUntilDue`, `isOverdue`, `agingBucket`, `AGING_BUCKETS`, `AGING_BUCKET_LABELS`, `PAYMENT_TERMS_DAYS`, `PAYMENT_TERMS_LABELS`, `formatDate`, `formatShortDate`, `formatDateTime`, `formatDueDistance`, `formatRelativeTime`, `toDateInputValue`, `fromDateInputValue`, `todayUtc` |
| `src/lib/bill-status.ts` | `BILL_TRANSITIONS`, `canTransition`, `assertTransition`, `InvalidBillTransitionError`, `allowedTransitions`, `isTerminalStatus`, `BILL_STATUS_META`, `BILL_STATUS_ORDER`, `PAYMENT_STATUS_META`, `draftReadiness`, `draftReadinessDetail`, `DRAFT_READINESS_META`, `canSubmitForApproval` |
| `src/lib/approval-policy.ts` | `resolveApprovalPolicy`, `resolveApproverChain`, `approvalProgress` |
| `src/lib/current-user.ts` | `getCurrentUser()`, `listDemoUsers()`, `setCurrentUser(userId)` *(server action)* |
| `src/server/bill-detail.ts` | `getBillDetail(id)`, `billDetailInclude`, types `BillDetail`, `BillDetailLineItem`, `BillDetailApprovalStep`, `BillDetailPayment`, `BillDetailActivity` |
| `src/server/reference-data.ts` | `getActiveGlAccounts()`, `getActiveVendors()`, `getApprovalPolicies()` |
| `src/server/schema-parity.ts` | *(nothing at runtime)* — compile-time assertions that `@/lib/domain` matches the Prisma enums |

Shared UI primitives, same rule:

| Component | Purpose |
| --- | --- |
| `@/components/common/page-header` | `<PageHeader title description actions />` |
| `@/components/common/empty-state` | `<EmptyState icon title description action />` |
| `@/components/common/stat-card` | `<StatCard label value hint icon tone />` |
| `@/components/common/loading` | `<TableSkeleton />`, `<StatCardsSkeleton />`, `<PanelSkeleton />` |
| `@/components/common/stub-panel` | `<StubPanel title owner summary />` — delete as each slot is filled |
| `@/components/shell/user-avatar` | `<UserAvatar initials color />` |

---

## 5. Ownership map — who edits what

> This section mirrors the Phase 1 split in [[IMPLEMENTATION-PLAN]] §3, which is
> **authoritative**. If the two ever disagree, the plan wins and this table is
> the one that is wrong.

Three verticals run in parallel, one git worktree each. **Do not edit a file
outside your column** (ADR 0007, single-writer file ownership).

### Frozen for everyone

`src/lib/**` · `src/server/bill-detail.ts` · `src/server/reference-data.ts` ·
`src/server/schema-parity.ts` · `src/components/ui/**` ·
`src/components/common/**` · `src/components/shell/**` · `src/app/layout.tsx` ·
`src/app/(app)/layout.tsx` · **`src/app/(app)/bills/[id]/page.tsx`** ·
`prisma/**` · `Dockerfile`, `docker-compose.yml`, `docker/**`.

The bill detail page is frozen **without exception**. It already loads the bill
and its relations in one query and hands the same `BillDetail` to every panel,
which is precisely what lets three agents fill its slots at once. It is not a
file you may edit to add a relation: `billDetailInclude` lives in
`src/server/bill-detail.ts`, which is frozen too, and widening it changes a type
every vertical depends on.

**If you need a wider `billDetailInclude`, or any other change to a frozen file:
STOP and coordinate.** Do not edit it yourself, do not add a second query inside
a component to work around it, and do not fork the type. A one-line edit to a
shared file is exactly the merge conflict this phase exists to prevent.

### Vertical A — bills inbox and bill creation

| | |
| --- | --- |
| **Owns** | `src/components/bills/bills-inbox.tsx` · `src/components/bills/bill-status-badge.tsx` *(new)* · `src/components/bills/new-bill-form.tsx` *(new)* · `src/app/(app)/bills/page.tsx` · `src/app/(app)/bills/loading.tsx` · `src/app/(app)/bills/new/page.tsx` *(new)* · `src/server/actions/bills.ts` *(new)* · `src/server/queries/bills.ts` *(new)* · `src/lib/bill-filters.ts` *(new, pure)* |
| **Fills** | `<BillsInbox/>` |
| **Reads, never edits** | all of `src/lib/**`, `src/server/reference-data.ts`, `src/components/common/**`, `src/components/ui/**` |

### Vertical B — bill detail

| | |
| --- | --- |
| **Owns** | `src/components/bills/bill-header.tsx` · `src/components/bills/line-items-editor.tsx` · `src/components/bills/invoice-preview.tsx` · `src/components/activity/**` · `src/server/actions/bill-edit.ts` *(new)* |
| **Fills** | `<BillHeader/>`, `<LineItemsEditor/>`, `<InvoicePreview/>`, `<ActivityFeed/>` |
| **Reads, never edits** | `src/app/(app)/bills/[id]/page.tsx`, `src/lib/**`, vertical A's `bill-status-badge.tsx` |

### Vertical C — approval and payment

| | |
| --- | --- |
| **Owns** | `src/components/approvals/**` · `src/components/payments/**` · `src/server/actions/approvals.ts` *(new)* · `src/server/actions/payments.ts` *(new)* |
| **Fills** | `<ApprovalPanel/>`, `<PaymentPanel/>` |
| **Reads, never edits** | `src/lib/approval-policy.ts`, `src/lib/bill-status.ts`, `src/server/reference-data.ts`, `src/app/(app)/bills/[id]/page.tsx` |

### Phase 2 — integration (sequential, NOT a parallel vertical)

The aggregation views are read-only reports over data the verticals produce, so
they are built **after** the three worktrees merge, not beside them.

| | |
| --- | --- |
| **Owns** | `src/components/dashboard/**` · `src/components/aging/**` · `src/components/vendors/**` · `src/app/(app)/dashboard/page.tsx` · `src/app/(app)/aging/**` · `src/app/(app)/vendors/**` · `src/server/queries/reports.ts` *(new)* |
| **Fills** | `<DashboardSummary/>`, `<AgingReport/>`, `<VendorList/>` |

### `src/components/bills/` is shared — owned file by file

Verticals A and B both write inside this directory, so it is **never** claimed
as a glob. Every file has exactly one owner:

| File | Owner |
| --- | --- |
| `bills-inbox.tsx` | **A** |
| `bill-status-badge.tsx` *(new)* | **A** |
| `new-bill-form.tsx` *(new)* | **A** |
| `bill-header.tsx` | **B** |
| `line-items-editor.tsx` | **B** |
| `invoice-preview.tsx` | **B** |

Vertical B renders A's `<BillStatusBadge/>` and must not edit it; if the badge
needs a new variant, coordinate rather than patching it in place.

New server actions go in `src/server/actions/<vertical>.ts` so two verticals
never open the same file. New pure helpers go in `src/lib/<feature>.ts`, never
into the foundation modules in §4.

### Stub props contracts (fixed — do not change the signatures)

The page that renders a stub fixes its contract; the vertical implements against
it. Changing a signature forces an edit to a page someone else owns, which this
design forbids. `User` and `GlAccount` come from `@prisma/client`, `BillDetail`
from `@/server/bill-detail`.

```ts
// src/components/bills/bills-inbox.tsx                      — vertical A
export interface BillsInboxProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

// src/components/bills/bill-header.tsx                      — vertical B
export interface BillHeaderProps { bill: BillDetail; currentUser: User }

// src/components/bills/line-items-editor.tsx                — vertical B
export interface LineItemsEditorProps { bill: BillDetail; glAccounts: GlAccount[] }

// src/components/bills/invoice-preview.tsx                  — vertical B
export interface InvoicePreviewProps { bill: BillDetail }

// src/components/activity/activity-feed.tsx                 — vertical B
export interface ActivityFeedProps { bill: BillDetail }

// src/components/approvals/approval-panel.tsx               — vertical C
export interface ApprovalPanelProps { bill: BillDetail; currentUser: User }

// src/components/payments/payment-panel.tsx                 — vertical C
export interface PaymentPanelProps { bill: BillDetail; currentUser: User }

// src/components/dashboard/dashboard-summary.tsx            — phase 2
export interface DashboardSummaryProps { currentUser: User }

// src/components/vendors/vendor-list.tsx                    — phase 2
export function VendorList(): ReactNode;   // no props — reads its own data

// src/components/aging/aging-report.tsx                     — phase 2
export function AgingReport(): ReactNode;  // no props — reads its own data
```

---

## 6. Seed data

`prisma/seed-data.ts` is pure data, `prisma/seed-compute.ts` derives amounts and
dates from it, `prisma/seed.ts` writes it, and `scripts/generate-invoices.ts`
renders one placeholder invoice PDF per bill from the *same* numbers — so the
document in the viewer always matches the row in the table.

The dataset is deterministic: every id, name, amount and line is hardcoded, and
the only PRNG (`makeRandom(20260101)`) is fixed-seed. Due dates are expressed as
**offsets from today**, so the AP Aging report keeps every bucket populated
whenever the reviewer runs it.

| Table | Rows |
| --- | --- |
| users | 6 (3 approvers: Controller, CFO, Head of Operations) |
| gl_accounts | 17 |
| vendors | 16 |
| approval_policies / steps | 3 / 3 |
| bills | 45 (8 draft, 10 awaiting approval, 7 approved, 14 paid, 3 rejected, 3 archived) |
| line_items | 82 |
| payments | 18 (14 paid, 2 scheduled, 1 initiated, 1 failed) |
| approval_steps | 47 |
| activities | 157 |

Deliberate demo hooks:

- 4 of the 8 drafts are `Missing info` — one with no GL account, one whose lines
  do not sum to the total (an OCR mismatch), one with no line items at all, and
  one with a single uncoded line from a CSV import.
- Bills awaiting approval sit at different points in their chain (`0 of 1`,
  `0 of 2`, `1 of 2`).
- One approved bill (`SCC-0964`, $980) has **no** approval steps — it was
  auto-approved under the $1,000 policy.
- One approved bill carries a `FAILED` payment (ACH return), one an `INITIATED`
  check.
- Outstanding bills land in every aging bucket: Current, 1–30, 31–60, 61–90 and
  90+.

---

## 7. Docker

`docker compose up --build` starts Postgres 16 (with a healthcheck) and the app.
The app waits for the database, runs `prisma generate`, applies migrations with
`prisma migrate deploy`, seeds **only when the database is empty**
(`SEED_IF_EMPTY=1`, so a restart does not wipe the reviewer's work) and then
serves the Next.js standalone build on port 3000.

The image is multi-stage: `base` → `deps` (full tree, for the build) →
`prod-deps` (runtime tree) → `builder` (`prisma generate` + `next build`) →
`runner`. `prisma` and `tsx` are deliberately **runtime** dependencies, not dev
dependencies: the container migrates and seeds itself on start, and shipping the
exact pinned versions from the lockfile is more reliable than fetching them at
container start.

Local development without the app container:

```bash
docker compose up -d db
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```
