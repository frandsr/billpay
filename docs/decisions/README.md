---
type: adr-index
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay, index]
---

# Decision log — Bill Pay

Ten decisions shape this build. They are best read as one log in order rather than as separate groups, because the last three reopen the first seven — most sharply [0008](0008-scope-pivot-ingestion-over-reporting.md), which **amends both [0005](0005-deferred-features-are-additive.md) and [0003](0003-sequential-multi-step-approval-policies.md)**: the cut line recorded in 0005 no longer stands as written, and the approval design in 0003 was offered up as a trade and then deliberately kept. Neither should be taken at face value without 0008 beside it.

Three decisions are about **how to spend a six-hour budget**: [0001](0001-nextjs-full-stack-over-go-backend-and-spa.md) replaces an earlier Go + React SPA plan with a single Next.js full-stack app so there is one language, one deployable and no hand-written API layer; [0006](0006-demo-user-switcher-instead-of-auth.md) drops authentication for a seeded user switcher, because the multi-role approval chain has to be demonstrable in seconds rather than after a signup flow; and [0007](0007-foundation-first-parallel-agent-build.md) sequences the build as a shared foundation followed by feature verticals that own disjoint files, so the work parallelizes across agents without merge conflicts.

Four are about **modelling the payables domain**: [0002](0002-bill-and-payment-are-separate-entities.md) keeps Bill and Payment as separate entities with independent, server-enforced lifecycles instead of copying Ramp's ten statuses; [0003](0003-sequential-multi-step-approval-policies.md) makes approval a sequential multi-step chain snapshotted from amount-threshold policies at submit time, which is the internal control that makes this a business process rather than a CRUD app; [0004](0004-bill-total-is-authoritative.md) makes the bill total authoritative and line items the coding layer, so an incompletely itemised bill lands in `Missing info` rather than silently changing what is owed; and [0005](0005-deferred-features-are-additive.md) records the cut line — OCR, splits, recurring bills, partial payments and the rest are deferred, but each one is reachable by a purely additive migration whose seam already exists in the schema.

Three were taken during the build rather than before it. [0008](0008-scope-pivot-ingestion-over-reporting.md) is a mid-build scope inversion: the reviewer asked for four of the features 0005 had deferred — OCR, CSV import, line-item splits and recurring bills — so they came in, and the AP aging report and inbox bulk actions went out to pay for them; GL coding and approval were offered as the trade and kept, because splits have nothing to distribute into without the coding layer and approval was already built. [0009](0009-functional-core-over-hexagonal-ports.md) records where the domain rules actually live — a pure functional core in `src/lib` with Server Actions as the imperative shell, chosen over the ports-and-adapters design an earlier plan had specified. And [0010](0010-ocr-extraction-requires-human-review.md) governs the largest of the newly scoped features: OCR produces a draft for a human to review, never a finished bill, which is exactly the `Missing info` prompt 0004 predicted it would.

| ADR | Decision |
|-----|----------|
| [0001](0001-nextjs-full-stack-over-go-backend-and-spa.md) | Next.js full-stack (Server Actions + RSC, Prisma, Postgres, Docker) over a separate Go backend and React SPA. |
| [0002](0002-bill-and-payment-are-separate-entities.md) | Bill and Payment are separate entities with independent lifecycles; `Missing info` / `Ready` are derived, not stored. |
| [0003](0003-sequential-multi-step-approval-policies.md) | Sequential multi-step approval, generated at submit time from amount-threshold policies. |
| [0004](0004-bill-total-is-authoritative.md) | The bill total is the source of truth; line items code the spend and must reconcile to it. |
| [0005](0005-deferred-features-are-additive.md) | Deferred features are designed as additive migrations, not simply cut. |
| [0006](0006-demo-user-switcher-instead-of-auth.md) | A seeded demo user switcher replaces authentication; authorization is still enforced server-side. |
| [0007](0007-foundation-first-parallel-agent-build.md) | A sequential foundation phase locks the schema, shell and component stubs so feature verticals parallelize across agents without conflicts. |
| [0008](0008-scope-pivot-ingestion-over-reporting.md) | Mid-build pivot: OCR, CSV import, splits and recurring bills move into scope; the AP aging report and inbox bulk actions are cut. **Amends 0003 and 0005.** |
| [0009](0009-functional-core-over-hexagonal-ports.md) | A pure functional core in `src/lib` with Server Actions as the imperative shell, instead of ports and adapters. |
| [0010](0010-ocr-extraction-requires-human-review.md) | OCR yields a structured draft that lands in `Missing info` for human review; the raw extraction is persisted and never auto-applied. |
