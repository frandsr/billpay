---
type: adr
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay]
---

# 0006 — A demo user switcher instead of authentication

## Context
The approval chain from ADR 0003 only means anything if you can act as different people with different roles, and the audit trail records who did what to each bill. That makes identity load-bearing for the demo. But a reviewer has minutes, not patience for account creation, and authentication is a solved problem that demonstrates nothing about payables.

## Decision
No authentication. A user switcher in the top bar selects among seeded users — an AP clerk, a Controller and a CFO. The selection is stored in a cookie and read server-side by `getCurrentUser()`. Every approval decision and every activity entry is attributed to the selected user.

## Alternatives considered
- **Real authentication (NextAuth with credentials).** Rejected: roughly 40 minutes of a six-hour budget, spent on a component nobody is grading. Worse, it makes demonstrating a multi-role approval chain *slower* — the reviewer would have to sign out and back in to advance a bill one step.
- **A single hardcoded user.** Rejected: it makes the approval chain undemonstrable and the audit trail uniform, which defeats the point of ADR 0003 entirely.

## Consequences
The multi-role workflow is demonstrable in seconds: submit as the clerk, approve as the Controller, approve as the CFO, schedule the payment — without leaving the page. This is clearly a demo affordance and not a production posture, and the README must say so explicitly rather than let a reviewer wonder whether it was an oversight.

Importantly, authorization is still enforced server-side against the selected user: a user who is not the current approver on a bill cannot approve it, regardless of what the UI offers. The identity is fake; the enforcement logic is real, so swapping the cookie for a session is a one-function change in `getCurrentUser()`.
