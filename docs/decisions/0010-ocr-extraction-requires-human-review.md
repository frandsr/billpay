---
type: adr
status: accepted
date: 2026-08-06
domain: bill-pay
tags: [adr, bill-pay]
---

# 0010 — OCR produces a draft for human review, never a finished bill

## Context
Invoice OCR is now in scope (ADR 0008). Extraction from real invoices is probabilistic: totals read reliably, line items do not — lines get missed and taxes are not itemised. ADR 0004 anticipated exactly this failure mode when it made the bill total authoritative and the line items the coding layer.

## Decision
OCR is an ingestion channel that produces a **draft for a human to review**, never a finished bill. Three rules follow.

1. The model is asked for **structured output against a JSON schema** — vendor, invoice number, dates, total, currency and line items as typed fields — not prose to be parsed with regexes.
2. The raw provider response is persisted in an `OcrExtraction` row alongside the bill, so an extraction is auditable and re-reviewable rather than silently overwriting what a person typed.
3. The extracted bill lands as a `DRAFT`, and because the extracted lines usually will not reconcile to the extracted total it lands specifically in the derived `Missing info` state, which cannot be submitted for approval until a person resolves it.

The provider is Gemini, `gemini-3.1-flash-lite` primary — chosen on daily request quota rather than raw quality, because a demo that exhausts its rate limit is worse than one that occasionally mis-reads a line — cascading to a stronger Flash model and finally to a deterministic mock, so the build never depends on a secret being present.

## Alternatives considered
- **Auto-apply the extraction and mark the bill ready.** Rejected: it pushes an extraction error into the ledger and then into a payment, which is the one class of bug this product must not have.
- **Free-text prompting with parsing.** Rejected: brittle, and it makes the failure mode invisible.
- **A local OCR library.** Rejected: worse at structure, and it would still need the same human-review gate — more work without less risk.

## Consequences
The mismatch between extracted lines and extracted total becomes a visible, actionable prompt rather than a silent corruption, which is where the `Missing info` state earns its existence. The mock fallback keeps the product runnable with no API key, which matters for a reviewer cloning the repo. The cost is that OCR never fully automates entry — the correct trade for money movement, but one the README should state plainly.
