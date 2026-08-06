---
type: adr
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay]
---

# 0003 — Sequential multi-step approval driven by amount-threshold policies

## Context
"Ability to grok complex workflows and business use cases" is explicitly graded, and approval is the control that makes payables a business process rather than a CRUD app. It exists for internal control and segregation of duties: the person who enters a bill must not be the person who releases the money, and larger amounts must reach more senior eyes. Any payables product that skips this is a to-do list with a currency symbol.

## Decision
Bills are approved through a sequential, multi-step chain, presented to the user as "X of N". The chain is generated at submit time from **approval policies**. A policy has a priority and a minimum-amount threshold and carries an ordered list of approvers. A bill matches the **first** applicable policy and receives a **copy** of that chain as `ApprovalStep` rows.

Approval is sequential only: step *n+1* becomes actionable when step *n* is approved. A rejection at any step moves the bill to `REJECTED`. A matching policy with an empty chain means auto-approved — the intended modelling for small-value bills.

## Alternatives considered
- **A single approver.** Rejected: cheaper to build, but indistinguishable from a to-do app on the dimension the rubric weighs most heavily.
- **Policy conditions on vendor and department as well as amount.** Deferred: more matching complexity without introducing a new concept. Amount thresholds already demonstrate the mechanism end to end.
- **Parallel approval, escalation, delegation, AND/OR combinators.** Deferred: all real Ramp features, but each multiplies the state to track for diminishing demonstrative value inside the time budget.

## Consequences
Because the chain is snapshotted onto the bill at submit time, later edits to a policy do not retroactively change bills already in flight — which is the correct audit behaviour, not a shortcut. Adding parallel approval later means introducing a step-group concept; sequential ordering does not block it. The cost is that a policy change requires re-submission to take effect on an in-flight bill, which must be visible in the UI.
