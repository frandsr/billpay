---
type: glossary
domain: ramp-bill-pay
tags: [glossary, ramp-bill-pay]
---
# Glossary — Ramp Bill Pay (take-home)

## Entities

**Bill**:
The accounts-payable record owed to a vendor; aggregates line items and moves through the approval/payment lifecycle. In the MVP it is settled by one (1) Payment.
_Avoid_: invoice (that is the attached document, not the bill).

**Vendor**:
The supplier being paid; a reusable entity holding payment details (account/address) and default payment terms. A vendor has many bills.
_Avoid_: mixing payee/supplier without criteria.

**Line item**:
A detail line within a bill (description, quantity, price, amount). Each line is coded independently.
_Avoid_: "item" on its own (clashes with the expense-vs-item axis).

**Payment**:
A **separate** entity from the Bill representing payment execution (method, send/arrival dates, its own status). In the MVP a bill is settled by a single Payment for the full amount.
_Avoid_: treating Bill and Payment as the same thing.

**Invoice (document)**:
The attached file (PDF/image) that backs a bill and from which OCR extracts data. It is NOT the bill.
_Avoid_: using "invoice" to mean the Bill.

## Accounting coding

**GL account**:
The chart-of-accounts account the spend hits (e.g. *Software Expense*, *Rent*). Assigned per line item or per split.
_Avoid_: category (that is a dimension).

**Dimension**:
An additional classification axis on a line (department, category, location), orthogonal to the GL account.
_Avoid_: account / GL.

**Split**:
The distribution of **one** line (or the bill) across several GL accounts/dimensions, by percentage or fixed amount. The sum of splits = the line amount.
_Avoid_: allocation template (the split is the instance; the template is the reusable pattern).

**Allocation template**:
A saved, named Split, reusable to apply the same distribution to future bills.
_Avoid_: split (instance vs template).

## Bill statuses

**Draft**:
Initial stage; the bill was created/ingested but not submitted for approval. Derived sub-flags: `Missing info` and `Ready`.

**Missing info**:
Derived flag of a Draft missing required fields to be submitted — typically an OCR-scanned bill with incomplete extraction. Opposite: `Ready`.
_Avoid_: confusing it with `Waiting for match` (that is card reconciliation, not missing data).

**Ready**:
Derived flag of a Draft with all required fields present; ready to submit for approval.

**Awaiting approval**:
The bill is in the approval flow, awaiting one or more approvers.
_Avoid_: "pending" (ambiguous).

**Approved**:
Approved, eligible to schedule payment.

**Paid**:
The associated Payment completed.

**Rejected**:
An approver rejected the bill.

**Archived**:
Removed from the flow without being paid; not deleted.
_Avoid_: deleted (archiving ≠ deleting).

**Waiting for match** _(out of scope)_:
Ramp status for a bill paid by Ramp card awaiting a match with the card transaction. We do not implement it.
_Avoid_: using it for "draft without an invoice" — that is `Missing info`.

## Payment statuses

**Scheduled**:
The Payment was scheduled (method + date) and awaits execution.

**Initiated**:
The Payment was initiated / is in transit (e.g. ACH on the way).
_Avoid_: using it as a Bill status — it lives on the Payment.

**Failed**:
The Payment could not be completed.
