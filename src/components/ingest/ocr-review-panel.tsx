import { ScanLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PAYMENT_TERMS_LABELS } from "@/lib/dates";
import { formatDate, formatDateTime, toDateInputValue } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  OCR_FIELD_KEYS,
  OCR_FIELD_LABELS,
  isLowConfidence,
  matchVendorName,
  normalizeOcrRawResult,
  reconcileExtraction,
  type OcrFieldKey,
  type OcrExtractionResult,
} from "@/lib/ocr-schema";
import { formatBasisPoints } from "@/lib/splits";
import { cn } from "@/lib/utils";
import type { BillDetail } from "@/server/bill-detail";
import { getActiveVendors } from "@/server/reference-data";

import { ApplyFieldButton, ApplyVendorControl, RerunExtractionButton } from "./ocr-review-actions";

/**
 * The review half of OCR, on the bill detail page.
 *
 * Shows the newest `OcrExtraction` field by field, with what the extractor read
 * NEXT TO what the bill currently says, so a disagreement is visible rather than
 * implicit. Each row can be applied to the bill individually — that is the only
 * way an extracted value ever reaches a saved bill (ADR 0010: an extraction is
 * never auto-applied over work a person has done).
 *
 * Renders nothing when the bill has no extraction, which is most bills, so the
 * detail page mounts it unconditionally.
 *
 * The seeded run on IPS-3391 is the demo case: a scanned total of $6,890 against
 * extracted lines of $6,240.
 */
export interface OcrReviewPanelProps {
  bill: BillDetail;
}

export async function OcrReviewPanel({ bill }: OcrReviewPanelProps) {
  const extraction = bill.ocrExtractions[0];
  if (!extraction) return null;

  const result = normalizeOcrRawResult(extraction.rawResult);
  if (!result) return null;

  const vendors = await getActiveVendors();
  const vendorMatch = matchVendorName(
    result.fields.vendorName.value,
    vendors.map((vendor) => ({ id: vendor.id, name: vendor.name })),
  );
  const reconciliation = reconcileExtraction(result);
  const isDraft = bill.status === "DRAFT";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ScanLine className="size-4" />
          OCR review
          <Badge variant="outline" className="font-mono text-[10px]">
            {extraction.provider}
          </Badge>
          {extraction.confidenceBasisPoints !== null ? (
            <Badge
              variant="outline"
              className={cn(
                "font-mono text-[10px]",
                isLowConfidence(extraction.confidenceBasisPoints)
                  ? "border-orange-300 text-orange-800 dark:border-orange-800/60 dark:text-orange-300"
                  : "text-muted-foreground",
              )}
            >
              {formatBasisPoints(extraction.confidenceBasisPoints)} confidence
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Read {formatDateTime(extraction.extractedAt)}
          {result.documentFileName ? ` from ${result.documentFileName}` : ""}. An extraction
          is a proposal: nothing below is on the bill until you put it there.
        </p>

        <div className="divide-border divide-y rounded-lg border">
          <div className="text-muted-foreground grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 px-3 py-2 text-xs font-medium">
            <span>Field</span>
            <span>Extracted</span>
            <span>On the bill</span>
            <span className="sr-only">Action</span>
          </div>

          {OCR_FIELD_KEYS.map((key) => {
            const extracted = formatExtracted(key, result);
            const current = formatCurrent(key, bill);
            const agrees = extracted !== "—" && extracted === current;
            const confidence = result.fields[key].confidenceBasisPoints;

            return (
              <div
                key={key}
                className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">{OCR_FIELD_LABELS[key]}</span>
                <span className="min-w-0">
                  <span className="block truncate">{extracted}</span>
                  {confidence !== null ? (
                    <span
                      className={cn(
                        "font-mono text-[10px]",
                        isLowConfidence(confidence)
                          ? "text-orange-700 dark:text-orange-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {formatBasisPoints(confidence)}
                      {isLowConfidence(confidence) ? " · check this one" : ""}
                    </span>
                  ) : null}
                </span>
                <span className={cn("min-w-0 truncate", agrees ? "" : "font-medium")}>
                  {current}
                </span>
                <span className="justify-self-end">
                  {agrees ? (
                    <span className="text-muted-foreground text-xs">matches</span>
                  ) : key === "vendorName" ? (
                    <ApplyVendorControl
                      billId={bill.id}
                      disabled={!isDraft}
                      candidates={vendorMatch.candidates}
                      suggestedVendorId={vendorMatch.suggested?.id ?? null}
                      currentVendorId={bill.vendorId}
                    />
                  ) : (
                    <ApplyFieldButton
                      billId={bill.id}
                      field={key}
                      label={OCR_FIELD_LABELS[key]}
                      disabled={!isDraft || extracted === "—"}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {!isDraft ? (
          <p className="text-muted-foreground text-xs">
            This bill has left draft, so extracted values can no longer be applied to it.
          </p>
        ) : null}

        <Separator />

        <div className="space-y-2">
          <p className="text-sm font-medium">Extracted line items</p>
          {result.lineItems.length === 0 ? (
            <p className="text-muted-foreground text-sm">The scan produced no line items.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {result.lineItems.map((line, index) => (
                <li
                  key={`${line.description}-${index}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="min-w-0 truncate">
                    {line.description}
                    <span className="text-muted-foreground">
                      {" "}
                      · {line.quantity} ×{" "}
                      {formatCents(line.unitPriceCents, { currency: result.currency })}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {formatCents(line.amountCents, { currency: result.currency })}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {result.removedSummaryRows.length > 0 ? (
            <div className="text-muted-foreground space-y-1 rounded-md border border-dashed px-3 py-2 text-xs">
              <p className="font-medium">
                {result.removedSummaryRows.length === 1
                  ? "1 summary row was not imported as a line item"
                  : `${result.removedSummaryRows.length} summary rows were not imported as line items`}
              </p>
              <ul className="space-y-0.5">
                {result.removedSummaryRows.map((row, index) => (
                  <li
                    key={`${row.description}-${index}`}
                    className="flex justify-between gap-3"
                  >
                    <span className="min-w-0 truncate">
                      {row.description}
                      <span className="text-muted-foreground/80"> — {row.reason}</span>
                    </span>
                    <span className="tabular-nums">
                      {formatCents(row.amountCents, { currency: result.currency })}
                    </span>
                  </li>
                ))}
              </ul>
              <p>Tax and fees belong to the total, which is captured separately.</p>
            </div>
          ) : null}

          <div
            className={cn(
              "flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm",
              reconciliation.reconciles
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "bg-orange-50 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
            )}
          >
            <span>
              {reconciliation.reconciles
                ? "Extracted lines match the extracted total"
                : "Extracted lines do not match the extracted total"}
            </span>
            <span className="font-medium tabular-nums">
              {formatCents(reconciliation.lineTotalCents, { currency: result.currency })}
              {" vs "}
              {reconciliation.totalCents === null
                ? "—"
                : formatCents(reconciliation.totalCents, { currency: result.currency })}
            </span>
          </div>
          {!reconciliation.reconciles ? (
            <p className="text-muted-foreground text-xs">
              The header total is what is owed; the lines exist to code it. The gap is not
              reconciled automatically — a person decides whether a line was missed or the
              total was misread.
            </p>
          ) : null}
        </div>

        {result.warnings.length > 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Flagged by the extractor</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-sm">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            {bill.ocrExtractions.length === 1
              ? "One extraction on record."
              : `${bill.ocrExtractions.length} extractions on record — re-running appends, it never overwrites.`}
            {bill.ocrExtractions.length > 1
              ? ` Previous: ${bill.ocrExtractions
                  .slice(1)
                  .map((run) => `${run.provider} on ${formatDate(run.extractedAt)}`)
                  .join(", ")}.`
              : ""}
          </p>
          <RerunExtractionButton
            billId={bill.id}
            disabled={!bill.invoiceFileUrl}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/** What the extraction says, rendered the same way as the bill's own value. */
function formatExtracted(key: OcrFieldKey, result: OcrExtractionResult): string {
  const field = result.fields[key];
  if (field.value === null || field.value === undefined) return "—";

  switch (key) {
    case "totalCents":
      return formatCents(field.value as number, { currency: result.currency });
    case "issueDate":
    case "dueDate":
      return formatDate(`${field.value as string}T00:00:00.000Z`);
    case "paymentTerms":
      return PAYMENT_TERMS_LABELS[field.value as keyof typeof PAYMENT_TERMS_LABELS];
    default:
      return String(field.value);
  }
}

function formatCurrent(key: OcrFieldKey, bill: BillDetail): string {
  switch (key) {
    case "vendorName":
      return bill.vendor.name;
    case "billNumber":
      return bill.billNumber;
    case "issueDate":
      return formatDate(`${toDateInputValue(bill.issueDate)}T00:00:00.000Z`);
    case "dueDate":
      return formatDate(`${toDateInputValue(bill.dueDate)}T00:00:00.000Z`);
    case "paymentTerms":
      return PAYMENT_TERMS_LABELS[bill.paymentTerms];
    case "totalCents":
      return formatCents(bill.totalCents, { currency: bill.currency });
  }
}
