---
type: adr
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay]
---

# 0008 — Scope pivot: ingestion in, reporting out

## Context
ADR 0005 recorded a cut line: invoice OCR, CSV import, line-item splits and recurring bills were deferred, each one left with a seam in the schema so it could return as a purely additive migration. Partway through the build the reviewer asked directly for exactly those four features, offering to drop GL coding and approval in exchange. The budget did not grow.

## Decision
The four requested features — **invoice OCR, CSV import, line-item splits and recurring bills** — move into scope. To pay for them, the **AP aging report** and **inbox bulk actions** are cut.

Two of the things the reviewer offered to drop are kept. **GL coding** stays: a Split is by definition the distribution of a line across GL accounts and dimensions, so removing the coding layer leaves splits with nothing to distribute into. **Multi-step approval** stays: its domain logic (`src/lib/approval-policy.ts`), its policies and its seeded chains were already built in the foundation phase of ADR 0007, so keeping it cost far less than the estimate that justified dropping it.

Every new feature landed as an additive migration — `LineItemSplit`, `AllocationTemplate`, `RecurringBill`, `OcrExtraction` — with no change to an existing column.

## Alternatives considered
- **Take the list literally, dropping GL coding too.** Rejected: it breaks splits, which are one of the four requested features. The request is internally inconsistent; the coherent reading keeps the coding layer.
- **Absorb the four features without cutting anything.** Rejected: the budget is fixed, and six features at 70% is worse than four at 100%.
- **Keep the aging report by cutting manual bill creation instead.** Rejected: three ingestion paths and none of them the one a reviewer reaches for first. The aging report is pure reporting, and reporting is the most expendable thing next to the workflow itself.

## Consequences
This is ADR 0005 being cashed in: a mid-build scope inversion cost a short sequential migration pass rather than a rewrite, which is the strongest available evidence that the seams were real and not decorative. The README must present the cut line as it now stands, and note that the aging report is itself deferred behind a seam — due dates and payment state already carry everything the buckets need. The cost is that ADR 0003 and ADR 0005 must now be read together with this record rather than on their own.
