---
type: adr
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay]
---

# 0007 — Foundation-first layout so feature work parallelizes across agents

## Context
The build budget is roughly six hours of AI-assisted work, and the scope is the full AP loop of ADR 0005. That scope only fits if several feature verticals are built concurrently, in separate agent sessions on separate git worktrees. But concurrent agents collide. The natural decomposition — one agent per feature — puts three agents inside the bill detail page, the Prisma schema, the seed file and the navigation at the same time, and the merge conflicts that produces cost more than the parallelism saves.

## Decision
The build splits into a sequential foundation phase, then parallel verticals, then a sequential integration phase.

The foundation phase is a single agent on `main`, and it locks everything shared: the Prisma schema — including the seams ADR 0005 requires, so nobody has to migrate later — the seed data, the app shell and navigation, the shared libraries (`money`, `dates`, the `bill-status` state machine, `current-user`) and the page skeletons.

Critically, the foundation also creates every feature component as a **stub in its own file** — `ApprovalPanel`, `PaymentPanel`, `LineItemsEditor`, `InvoicePreview`, `ActivityFeed`, `BillsInbox`, `AgingReport` — with its props contract already fixed by the page that renders it. A parallel agent then implements stubs: it owns its own component files and its own server-action file, and edits nothing else. File ownership is single-writer by construction, so the worktrees merge cleanly.

## Alternatives considered
- **A fully sequential single-agent build.** Rejected: no coordination cost, but roughly 40% less shipped in the same wall-clock time.
- **Parallel agents with no foundation phase.** Rejected: the schema and the bill detail page are shared by every vertical, so the conflicts are structural, not incidental.
- **Coordinating by merge discipline rather than file ownership.** Rejected: it depends on agents behaving well under conflict, which is exactly the thing that is unreliable.

## Consequences
Roughly 20% of the budget goes to a phase that produces no visible feature, and the stub props contracts have to be right the first time — a wrong contract forces a cross-agent change, which is the one thing this design forbids. In exchange, three verticals proceed genuinely independently and integration is a merge rather than a reconciliation. The same structure is what makes ADR 0005's deferred features additive in practice: a new feature is a new stub in a new file, not an edit to an existing one.
