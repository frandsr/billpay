---
type: adr-index
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay, index]
---

# Decision log — Bill Pay

Seven decisions shape this build, and they divide into two groups. Three are about **how to spend a six-hour budget**: [0001](0001-nextjs-full-stack-over-go-backend-and-spa.md) replaces an earlier Go + React SPA plan with a single Next.js full-stack app so there is one language, one deployable and no hand-written API layer; [0006](0006-demo-user-switcher-instead-of-auth.md) drops authentication for a seeded user switcher, because the multi-role approval chain has to be demonstrable in seconds rather than after a signup flow; and [0007](0007-foundation-first-parallel-agent-build.md) sequences the build as a shared foundation followed by feature verticals that own disjoint files, so the work parallelizes across agents without merge conflicts. Four are about **modelling the payables domain**: [0002](0002-bill-and-payment-are-separate-entities.md) keeps Bill and Payment as separate entities with independent, server-enforced lifecycles instead of copying Ramp's ten statuses; [0003](0003-sequential-multi-step-approval-policies.md) makes approval a sequential multi-step chain snapshotted from amount-threshold policies at submit time, which is the internal control that makes this a business process rather than a CRUD app; [0004](0004-bill-total-is-authoritative.md) makes the bill total authoritative and line items the coding layer, so an incompletely itemised bill lands in `Missing info` rather than silently changing what is owed; and [0005](0005-deferred-features-are-additive.md) records the cut line — OCR, splits, recurring bills, partial payments and the rest are deferred, but each one is reachable by a purely additive migration whose seam already exists in the schema.

| ADR | Decision |
|-----|----------|
| [0001](0001-nextjs-full-stack-over-go-backend-and-spa.md) | Next.js full-stack (Server Actions + RSC, Prisma, Postgres, Docker) over a separate Go backend and React SPA. |
| [0002](0002-bill-and-payment-are-separate-entities.md) | Bill and Payment are separate entities with independent lifecycles; `Missing info` / `Ready` are derived, not stored. |
| [0003](0003-sequential-multi-step-approval-policies.md) | Sequential multi-step approval, generated at submit time from amount-threshold policies. |
| [0004](0004-bill-total-is-authoritative.md) | The bill total is the source of truth; line items code the spend and must reconcile to it. |
| [0005](0005-deferred-features-are-additive.md) | Deferred features are designed as additive migrations, not simply cut. |
| [0006](0006-demo-user-switcher-instead-of-auth.md) | A seeded demo user switcher replaces authentication; authorization is still enforced server-side. |
| [0007](0007-foundation-first-parallel-agent-build.md) | A sequential foundation phase locks the schema, shell and component stubs so feature verticals parallelize across agents without conflicts. |
