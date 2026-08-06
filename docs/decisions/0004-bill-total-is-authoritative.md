---
type: adr
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay]
---

# 0004 — The bill total is authoritative; line items exist to code the spend

## Context
A bill's total is what is owed to the vendor. Line items serve accounting: each one carries a GL account and dimensions so the spend lands in the right place in the ledger. These are two different jobs, and real ingestion separates them cleanly. When an invoice document is read by OCR — on our roadmap, see ADR 0005 — the total is extracted reliably but the itemisation is not: lines get missed, taxes are not broken out, and the sum of the extracted lines disagrees with the invoice total.

## Decision
`totalCents` on the bill header is the source of truth. Line items exist to code the spend, not to define the amount.

We validate `Σ(line items) == total`. When it does not reconcile, the bill stays in the derived `Missing info` state and cannot be submitted for approval. At least one line item is required — a simple bill is a single line for the total. Taxes and fees are modelled as line items, not as special-cased header fields. Money is stored in integer minor units, one currency per bill.

## Alternatives considered
- **Derive `total = Σ(lines)`.** Rejected. It is simpler, but it cannot represent the ingestion mismatch, which is the real-world case rather than the edge case. Worse, it would silently change what is owed to the vendor whenever coding is incomplete — the amount would follow the accountant's typing.
- **Allow submission without reconciliation.** Rejected: it pushes a coding error downstream into the ledger, where it is far more expensive to find than at the point of entry.

## Consequences
OCR ingestion slots in without redesign: an extraction that reads the total but only partially itemises produces exactly a `Missing info` draft, which is precisely the right prompt for human review. Taxes and fees need no schema of their own. The cost is one validation the UI must surface clearly — the user has to see *why* a draft is blocked and by how much it is out.
