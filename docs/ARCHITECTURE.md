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
| Data | Prisma + PostgreSQL 16 | Relational, migration-first, and the reporting queries are naturally SQL |
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
| `LineItemSplit` | `lineItemId`, `glAccountId`, `department?`, `amountCents`, `percentBasisPoints?`, `sortOrder` |
| `AllocationTemplate` | `name`, `description?`, `active` + `AllocationTemplateSplit(glAccountId, department?, percentBasisPoints, sortOrder)` |
| `RecurringBill` | `vendorId`, `name`, `amountCents`, `currency`, `paymentTerms`, `memo?`, `frequency`, `nextRunDate`, `dayOfMonth?`, `active`, `createdById`, `lastGeneratedAt?` + `RecurringBillLineItem(description, quantity, unitPriceCents, amountCents, glAccountId?, department?, lineType, sortOrder)` |
| `OcrExtraction` | `billId`, `rawResult` (Json), `extractedAt`, `provider`, `confidenceBasisPoints?` |

The four entities below the line arrived with the scope pivot of ADR 0008, as a
single additive migration: one new enum, one nullable `Bill.recurringBillId`,
six new tables, and **no change to an existing column**.

### Four invariants worth stating out loud

1. **`Bill.totalCents` is authoritative.** Line items are coding detail. When
   Σ(line items) ≠ `totalCents`, the bill is *not* silently corrected — it
   surfaces as `Missing info`. Accountants care about the difference; hiding it
   would be the bug.
2. **`Payment` is a separate entity with its own lifecycle.** There is no
   `SCHEDULED` bill status. A scheduled payment is an `APPROVED` bill that owns
   a `Payment` in status `SCHEDULED`. The relation is already 1:N, so partial
   payments are additive.
3. **`Missing info` / `Ready` are derived, never stored.** They are computed by
   `draftReadinessDetail()` from the bill, its line items **and their splits** —
   a line coded entirely by splits that reconcile is coded, so readiness has to
   look one level deeper than the line. Storing the flag would create a cache to
   invalidate on every edit.
4. **Σ(splits) equals the line amount, exactly.** A line with no splits is coded
   by its own `glAccountId`; a line with splits is coded by the splits, and they
   must add up to the cent. Percentages are stored as **basis points**
   (1% = 100), never floats, and cents are handed out by
   `distributeByBasisPoints` using the largest remainder method — so a 1/3
   split of $100 is 33.34 / 33.33 / 33.33 rather than three amounts that quietly
   lose a cent.

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

The point of the schema is that none of the following requires a destructive
change: no column drops, no type changes, no data backfill that rewrites
existing rows.

The first three items were **claims** until the reviewer asked for them
mid-build. ADR 0008 cashed them in, and they cost one sequential migration pass
rather than a rewrite — which is the only real evidence that a seam was ever
more than a paragraph.

### Line-item splits + allocation templates — SHIPPED (ADR 0008)

`LineItem.amountCents` is the line's total and `glAccountId` is nullable, so a
split arrived as a **child** of a line, `LineItemSplit`, with no change to
`LineItem` at all. Existing rows stayed valid: a line with no splits is a line
coded entirely to its own `glAccountId`.

`AllocationTemplate` + `AllocationTemplateSplit` is the same shape without a
`lineItemId`, and percentage-only — an amount-based template would not survive
being applied to a line of a different size. Templates and splits never share a
table, exactly as the glossary distinguishes them.

### Recurring bills — SHIPPED (ADR 0008)

A recurring bill is a *generator*, not a bill. It arrived as `RecurringBill` +
`RecurringBillLineItem` (so a generated draft is already coded) plus **one
nullable column** on `Bill`:

```prisma
recurringBillId String?
```

Every pre-existing bill keeps `NULL`. Nothing about the lifecycle changed — the
generator simply creates DRAFT bills on a schedule.

### OCR / CSV ingestion — SHIPPED (ADR 0008); email deferred

`Bill.source` was already a `BillSource` enum with `MANUAL | OCR | CSV | EMAIL`
(`RECURRING` was added later, as the one-line additive migration ADR 0005
predicts, so a generated bill records the channel it arrived by),
and `invoiceFileUrl` / `invoiceFileName` already held the document, so neither
ingestion path needed a `Bill` column.

Extraction metadata went where §3 said it would: a sibling table, not a wider
`Bill`. `OcrExtraction` keeps the provider's raw response, the provider name and
a confidence in basis points, so a run is auditable and re-reviewable instead of
silently overwriting what a person typed (ADR 0010). Email forwarding stays
deferred behind the same `source = EMAIL` seam — it needs an inbound mail rail,
not a schema change.

### AP aging report — DEFERRED (ADR 0008)

Cut to pay for the four features above. It is pure reporting over data that
already exists: `dueDate`, `status` and the payment rows carry everything the
buckets need, and `agingBucket()` / `AGING_BUCKETS` are already implemented and
tested in `src/lib/dates.ts`. Rebuilding it is a query and a table, with no
migration at all.

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
| `src/lib/domain.ts` | `BillStatus`, `BillSource`, `PaymentStatus`, `PaymentMethod`, `PaymentTerms`, `ApprovalStepStatus`, `RecurringFrequency`, `UserRole` + the matching `BILL_STATUSES`-style const arrays |
| `src/lib/db.ts` | `db` / `prisma` — Prisma client singleton |
| `src/lib/money.ts` | `formatCents`, `parseAmountToCents`, `sumCents`, `lineAmountCents`, `dollars`, `minorUnitDigits` |
| `src/lib/dates.ts` | `dueDateFrom`, `daysOverdue`, `daysUntilDue`, `isOverdue`, `agingBucket`, `AGING_BUCKETS`, `AGING_BUCKET_LABELS`, `PAYMENT_TERMS_DAYS`, `PAYMENT_TERMS_LABELS`, `formatDate`, `formatShortDate`, `formatDateTime`, `formatDueDistance`, `formatRelativeTime`, `toDateInputValue`, `fromDateInputValue`, `todayUtc` |
| `src/lib/bill-status.ts` | `BILL_TRANSITIONS`, `canTransition`, `assertTransition`, `InvalidBillTransitionError`, `allowedTransitions`, `isTerminalStatus`, `BILL_STATUS_META`, `BILL_STATUS_ORDER`, `PAYMENT_STATUS_META`, `draftReadiness`, `draftReadinessDetail`, `DRAFT_READINESS_META`, `canSubmitForApproval` |
| `src/lib/approval-policy.ts` | `resolveApprovalPolicy`, `resolveApproverChain`, `approvalProgress` |
| `src/lib/splits.ts` | `BASIS_POINTS_TOTAL`, `distributeByBasisPoints`, `applyAllocationTemplate`, `splitsReconcile`, `validateSplits`, `splitsAreValid`, `sumSplitCents`, `basisPointsOf`, `formatBasisPoints` + types `SplitLike`, `DraftSplit`, `AllocationRowLike`, `SplitReconciliation`, `SplitIssue`, `SplitIssueCode` |
| `src/lib/recurring.ts` | `nextOccurrence`, `dueOccurrences`, `nextRunDateAfter`, `upcomingOccurrences`, `isDue`, `daysInUtcMonth`, `RECURRING_FREQUENCY_MONTHS`, `RECURRING_FREQUENCY_LABELS` + type `RecurringSchedule` |
| `src/lib/approval-chain.ts` | `currentPendingStep`, `isChainComplete`, `refuseDecision`, `canDecideCurrentStep`, `APPROVAL_STEP_STATUS_LABELS` |
| `src/lib/payment-lifecycle.ts` | `PAYMENT_TRANSITIONS`, `canTransitionPayment`, `assertPaymentTransition`, `InvalidPaymentTransitionError`, `isPaymentSettled`, `missingVendorPaymentDetails`, `availablePaymentMethods`, `paymentReference`, `PAYMENT_METHOD_LABELS`, `PAYMENT_METHOD_HINTS` |
| `src/lib/permissions.ts` | `refusePaymentExecution`, `canExecutePayments`, `refuseBillReopen`, `canReopenBill`, `describeRoles`, `PAYMENT_EXECUTION_ROLES`, `BILL_REOPEN_ROLES`, `USER_ROLE_LABELS` |
| `src/lib/outstanding.ts` | `OUTSTANDING_STATUSES`, `UNPAID_INCLUDING_DRAFTS_STATUSES`, `DUE_DATE_RELEVANT_STATUSES`, `isOutstanding`, `isUnpaidIncludingDrafts` |
| `src/lib/action-result.ts` | `ActionResult` — the `{ ok, message }` a Server Action returns |
| `src/lib/uploads.ts` | `MAX_INVOICE_UPLOAD_BYTES`, `MAX_CSV_UPLOAD_BYTES`, `SERVER_ACTION_BODY_LIMIT_BYTES`, `formatBytes` |
| `src/lib/current-user.ts` | `getCurrentUser()`, `listDemoUsers()`, `setCurrentUser(userId)` *(server action)* |
| `src/server/bill-detail.ts` | `getBillDetail(id)`, `billDetailInclude`, types `BillDetail`, `BillDetailLineItem`, `BillDetailSplit`, `BillDetailApprovalStep`, `BillDetailPayment`, `BillDetailActivity`, `BillDetailOcrExtraction` |
| `src/server/reference-data.ts` | `getActiveGlAccounts()`, `getActiveVendors()`, `getApprovalPolicies()` |
| `src/server/queries/recurring.ts` | `listRecurringTemplates()`, `getRecurringTemplate(id)`, `getRecurringTemplateForForm(id)`, `toFormInput(template)` |
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

> **Historical.** This map governed the parallel build. That phase is
> complete and merged; a consolidation pass afterwards moved the pure domain
> modules the map had stranded in component directories into the functional
> core — `approval-chain.ts` and `payment-lifecycle.ts` to `src/lib/`, the
> recurring reads to `src/server/queries/recurring.ts` — and gave the twice
> declared `ActionResult` a single home. The table is kept as the record of
> how the work was partitioned, not as a live constraint.

**This table is authoritative for file ownership.** It reflects the scope of
ADR 0008: invoice OCR, CSV import, line-item splits and recurring bills are in;
the **AP aging report** and **inbox bulk actions** are cut. Any older plan that
describes three verticals, or an `aging` route, predates that pivot.

Five verticals run in parallel, one git worktree each. **Do not edit a file
outside your column** (ADR 0007, single-writer file ownership). Every file below
has exactly one owner; where two verticals share a directory it is listed file
by file and **never** claimed as a glob.

### Frozen for everyone

`src/lib/**` · `src/server/bill-detail.ts` · `src/server/reference-data.ts` ·
`src/server/schema-parity.ts` · `src/components/ui/**` ·
`src/components/common/**` · `src/components/shell/**` · `src/app/layout.tsx` ·
`src/app/(app)/layout.tsx` · **`src/app/(app)/bills/[id]/page.tsx`** ·
`prisma/**` · `Dockerfile`, `docker-compose.yml`, `docker/**`.

Frozen means **do not edit**, not "do not use" — every vertical imports from
`src/lib/**` constantly. Adding a *new* file at `src/lib/<feature>.ts` is fine
and is how a vertical contributes pure logic; editing `money.ts`, `dates.ts`,
`bill-status.ts`, `approval-policy.ts`, `splits.ts`, `recurring.ts` or
`domain.ts` is not.

The bill detail page is frozen **without exception**. It loads the bill and its
relations in one query and hands the same `BillDetail` to every panel, which is
precisely what lets five agents fill its slots at once.

`billDetailInclude` was widened **once**, in this foundation pass, to carry
everything the five verticals need — line-item `splits` (with their
`glAccount`), `ocrExtractions` (newest first) and `recurringBill`. That was the
whole point of doing it here: **no vertical needs to touch the shared query.**
If you find yourself wanting a relation it does not have: STOP and coordinate.
Do not edit it, do not add a second query inside a component, and do not fork
the type. A one-line edit to a shared file is exactly the merge conflict this
phase exists to prevent.

### Vertical A — bills inbox and manual bill creation

Bulk actions are **cut** (ADR 0008). Do not build bulk selection.

| | |
| --- | --- |
| **Owns** | `src/components/bills/bills-inbox.tsx` · `src/components/bills/bill-status-badge.tsx` *(new)* · `src/components/bills/new-bill-form.tsx` *(new)* · `src/app/(app)/bills/page.tsx` · `src/app/(app)/bills/loading.tsx` · `src/app/(app)/bills/new/page.tsx` *(new)* · `src/server/actions/bills.ts` *(new)* · `src/server/queries/bills.ts` *(new)* · `src/lib/bill-filters.ts` *(new, pure)* |
| **Fills** | `<BillsInbox/>` |
| **Reads, never edits** | all of `src/lib/**`, `src/server/reference-data.ts`, `src/components/common/**`, `src/components/ui/**` |

### Vertical B — bill detail: line items, GL coding, splits UI, invoice preview, activity feed

| | |
| --- | --- |
| **Owns** | `src/components/bills/bill-header.tsx` · `src/components/bills/line-items-editor.tsx` · `src/components/bills/line-item-splits.tsx` *(new)* · `src/components/bills/invoice-preview.tsx` · `src/components/activity/**` · `src/server/actions/bill-edit.ts` *(new)* · `src/server/actions/splits.ts` *(new)* |
| **Fills** | `<BillHeader/>`, `<LineItemsEditor/>`, `<InvoicePreview/>`, `<ActivityFeed/>` |
| **Reads, never edits** | `src/app/(app)/bills/[id]/page.tsx`, `src/lib/**` (especially `splits.ts`), vertical A's `bill-status-badge.tsx` |

The splits UI lives **inside** the line-items editor: per line, switch between
direct coding and a split, add rows by percentage or fixed amount, apply a saved
`AllocationTemplate`, and show Σ(splits) against the line amount live. Use
`applyAllocationTemplate`, `distributeByBasisPoints`, `splitsReconcile` and
`validateSplits` — do not re-derive percentages or round in the component, and
never write an unbalanced split without surfacing the difference.

### Vertical C — approval (multi-step, X of N) and payment

| | |
| --- | --- |
| **Owns** | `src/components/approvals/**` · `src/components/payments/**` · `src/server/actions/approvals.ts` *(new)* · `src/server/actions/payments.ts` *(new)* |
| **Fills** | `<ApprovalPanel/>`, `<PaymentPanel/>` |
| **Reads, never edits** | `src/lib/approval-policy.ts`, `src/lib/bill-status.ts`, `src/server/reference-data.ts`, `src/app/(app)/bills/[id]/page.tsx` |

### Vertical D — ingestion: OCR upload/review and CSV import

| | |
| --- | --- |
| **Owns** | `src/components/ingest/**` (`import-wizard.tsx`, `invoice-upload.tsx`, `ocr-review-panel.tsx`) · `src/app/(app)/bills/import/**` · `src/app/(app)/bills/upload/**` · `src/server/actions/ingest.ts` *(new)* · `src/lib/csv.ts` *(new, pure)* · `src/lib/ocr-schema.ts` *(new, pure)* |
| **Fills** | `<ImportWizard/>`, `<InvoiceUpload/>`, `<OcrReviewPanel/>` |
| **Reads, never edits** | `src/lib/money.ts`, `src/lib/dates.ts`, `src/server/reference-data.ts`, `src/app/(app)/bills/[id]/page.tsx`, vertical A's `new-bill-form.tsx` |

Both ingestion paths write bills through the same rules the manual form uses.
OCR produces a `DRAFT` for review and persists the raw run as an
`OcrExtraction` — never a finished bill, never a silent overwrite (ADR 0010).

### Vertical E — recurring bills

| | |
| --- | --- |
| **Owns** | `src/components/recurring/**` · `src/app/(app)/recurring/**` (including any `new/` and `[id]/` routes it adds) · `src/server/actions/recurring.ts` *(new)* |
| **Fills** | `<RecurringList/>` |
| **Reads, never edits** | `src/lib/recurring.ts`, `src/lib/money.ts`, `src/lib/dates.ts`, `src/server/reference-data.ts` |

Generating writes DRAFT bills with `recurringBillId` set and the template's
lines copied in, then advances `nextRunDate` via `nextRunDateAfter`. A template
can owe more than one occurrence — `dueOccurrences` returns all of them, and
generating only the newest silently loses the rest.

### Phase 2 — integration (sequential, NOT a parallel vertical)

Runs after the five worktrees merge, because it reads data only the verticals
produce.

| | |
| --- | --- |
| **Owns** | `src/components/dashboard/**` · `src/components/vendors/**` · `src/app/(app)/dashboard/**` · `src/app/(app)/vendors/**` · `src/server/queries/reports.ts` *(new)* · the test suite · `README.md` |
| **Fills** | `<DashboardSummary/>`, `<VendorList/>` |
| **Also** | domain tests over the pure core, README, deploy |

**AP aging is cut** — there is no `src/app/(app)/aging/` and no
`src/components/aging/`. Do not recreate them. The bucket helpers stay in
`src/lib/dates.ts` because the dashboard uses overdue counts and the report is
deferred behind that seam, not deleted from the domain.

### Directories shared by two verticals — owned file by file

`src/components/bills/` is written by **A** and **B**, and
`src/app/(app)/bills/` by **A** and **D**, so neither is ever claimed as a glob:

| File | Owner |
| --- | --- |
| `src/components/bills/bills-inbox.tsx` | **A** |
| `src/components/bills/bill-status-badge.tsx` *(new)* | **A** |
| `src/components/bills/new-bill-form.tsx` *(new)* | **A** |
| `src/components/bills/bill-header.tsx` | **B** |
| `src/components/bills/line-items-editor.tsx` | **B** |
| `src/components/bills/line-item-splits.tsx` *(new)* | **B** |
| `src/components/bills/invoice-preview.tsx` | **B** |
| `src/app/(app)/bills/page.tsx` | **A** |
| `src/app/(app)/bills/loading.tsx` | **A** |
| `src/app/(app)/bills/new/page.tsx` *(new)* | **A** |
| `src/app/(app)/bills/import/page.tsx` | **D** |
| `src/app/(app)/bills/upload/page.tsx` | **D** |
| `src/app/(app)/bills/[id]/**` | **frozen** |

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

Several stubs take **no props** and read their own data server-side. That is
deliberate: a contract with no arguments cannot be the wrong contract, and the
shell page never has to change as the feature lands.

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

// src/components/ingest/ocr-review-panel.tsx                — vertical D
// Rendered on the bill detail page; returns null when the bill has no
// extraction, so the page mounts it unconditionally.
export interface OcrReviewPanelProps { bill: BillDetail }

// src/components/ingest/import-wizard.tsx                   — vertical D
export function ImportWizard(): ReactNode;   // no props — reads its own data

// src/components/ingest/invoice-upload.tsx                  — vertical D
export function InvoiceUpload(): ReactNode;  // no props — reads its own data

// src/components/recurring/recurring-list.tsx               — vertical E
export function RecurringList(): ReactNode;  // no props — reads its own data

// src/components/dashboard/dashboard-summary.tsx            — phase 2
export interface DashboardSummaryProps { currentUser: User }

// src/components/vendors/vendor-list.tsx                    — phase 2
export function VendorList(): ReactNode;     // no props — reads its own data
```

`BillDetail` already carries the new relations, so no panel above needs a wider
prop to reach them:

```ts
bill.lineItems[n].splits[m].glAccount   // vertical B — splits UI
bill.ocrExtractions[0].rawResult        // vertical D — OCR review
bill.recurringBill?.name                // vertical E — "generated from…"
```

## 6. Seed data

`prisma/seed-data.ts` is pure data, `prisma/seed-compute.ts` derives amounts and
dates from it, `prisma/seed.ts` writes it, and `scripts/generate-invoices.ts`
renders one placeholder invoice PDF per bill from the *same* numbers — so the
document in the viewer always matches the row in the table.

The dataset is deterministic: every id, name, amount and line is hardcoded, and
the only PRNG (`makeRandom(20260101)`) is fixed-seed. Due dates and recurring
run dates are expressed as **offsets from today**, so overdue bills and due
templates stay populated whenever the reviewer runs it.

| Table | Rows |
| --- | --- |
| users | 6 (3 approvers: Controller, CFO, Head of Operations) |
| gl_accounts | 17 |
| vendors | 16 |
| approval_policies / steps | 3 / 3 |
| bills | 46 (8 draft, 10 awaiting approval, 8 approved, 14 paid, 3 rejected, 3 archived) |
| line_items | 84 |
| line_item_splits | 16, across 6 lines |
| allocation_templates / splits | 2 / 5 |
| recurring_bills / line_items | 4 / 7 |
| ocr_extractions | 1 |
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
- Outstanding bills are spread across every age, from not-yet-due to more than
  90 days past due.
- 6 lines carry splits, including two months of the same lease coded 50/30/20
  from the "Office rent 50/30/20" template. Two AWS lines are split 70/30 and
  65/35 on amounts that do **not** divide evenly — the largest remainder
  distribution is visible in the demo data, not only in a test.
- 2 of the 4 recurring templates (`WeWork` monthly rent, `Northgate` quarterly
  insurance) are **already due**, so "generate now" produces a draft on the
  reviewer's first click. One is upcoming (`Figma`) and one is paused
  (`Sparkle City`).
- `Bellweather Design Studio` is deliberately **not fully onboarded**: no bank
  details and no remittance address, so ACH, wire and check each refuse by name
  and only the virtual card is left. Its approved bill `BWD-0295` ($5,050) is
  how a reviewer reaches `missingVendorPaymentDetails` — a rule that was
  otherwise correct, enforced and impossible to see.
- The OCR-mismatch draft `IPS-3391` ships with a stored `OcrExtraction`: the
  extractor read a $6,890 total but only $6,240 of lines, with per-field
  confidences and its own warnings — so the OCR review UI has a real
  disagreement to render before anyone uploads a file.

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
