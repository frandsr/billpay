---
type: adr
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay]
---

# 0005 — Deferred features are designed as additive, not cut

## Context
Six hours forces a narrow build, but the product should not read as a toy. The rubric rewards scope judgment, and scope judgment is not "built less" — it is a cut line that was chosen deliberately and can be explained. An omission that was never thought about looks the same in a demo as one that was designed around; it does not look the same in a README.

## Decision
We ship the core AP loop end to end: vendors, bills with line items and GL coding, the enforced state machine, multi-step approval, payment scheduling and completion, the bills inbox, bill detail, audit trail, dashboard and AP aging report — with realistic seeded demo data.

Deferred: invoice OCR, CSV import, AP email forwarding, line-item splits and allocation templates, recurring bills, partial payments, multi-currency, duplicate detection, 1099 tracking, and accounting-system sync.

The binding constraint is that every deferred feature must be reachable by a **purely additive** migration. Concretely: a `source` enum on the bill already models ingestion channels (manual, OCR, CSV, email); splits become a child table of the line item, with an allocation template as a named, reusable split; recurring bills become a template table that generates drafts; partial payments exploit the 1:N-capable Bill→Payment relation from ADR 0002.

## Alternatives considered
- **Build breadth shallowly across many features.** Rejected: the rubric rewards coherence and correctness, and a half-working OCR path damages the impression more than an absent one does.
- **Cut without designing the seams.** Rejected: "left out" then reads as "did not think about it", which is the exact judgement the scope criterion is looking for.

## Consequences
The README can state each omission next to the seam that admits it, which turns a list of missing features into evidence of a plan. The cost is a small amount of schema shaped for features not yet built — which has to be justified in review rather than defended as speculative generality.
