---
type: adr
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay]
---

# 0002 — Bill and Payment are separate entities with independent lifecycles

## Context
Ramp exposes around ten bill statuses, several of them tied to rails we do not have: card transaction match, paid off Ramp, vendor-detail requests. Copying that surface would produce statuses that no code path can ever set. We need a small, enforceable state machine that still models how payables actually work — and the observation that drives the design is that approving a bill and executing money movement are two different processes with different owners and different failure modes.

## Decision
The Bill lifecycle is `DRAFT → AWAITING_APPROVAL → APPROVED → PAID`, with two exits: `REJECTED` and `ARCHIVED`. There is deliberately **no** `SCHEDULED` bill status — scheduling is a property of the Payment, not the Bill.

The Payment is a separate entity with its own lifecycle: `SCHEDULED → INITIATED → PAID | FAILED`.

`Missing info` and `Ready` are **derived** flags on a Draft, computed from required-field presence and from whether the line items reconcile to the bill total (see ADR 0004). They are never stored as statuses.

Transitions are enforced server-side by `assertTransition`; the UI never writes a status directly. The Bill→Payment relation is modelled as 1:N-capable while the application enforces a single Payment for the full amount.

## Alternatives considered
- **Payment fields on the Bill** (`paymentMethod`, `scheduledDate`, `paidAt`). Rejected: it conflates two lifecycles, forces payment sub-states to be duplicated as bill statuses, and turns partial payments into a destructive migration later.
- **Replicating all ~10 Ramp statuses.** Rejected: most of them encode flows we have no rail for. They would be decorative, and decorative states are worse than absent ones because they imply behaviour that does not exist.

## Consequences
The bill state machine stays small enough to be provable and to be shown in the UI without a legend. Partial payments become purely additive later — add a balance and a partial status; no schema rewrite. The cost is one extra join to surface payment status in list views.
