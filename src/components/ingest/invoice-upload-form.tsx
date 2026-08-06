"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  ScanLine,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_TERMS_LABELS, dueDateFrom, formatDate, fromDateInputValue } from "@/lib/dates";
import { PAYMENT_TERMS, type PaymentTerms } from "@/lib/domain";
import { formatCents, lineAmountCents, parseAmountToCents, sumCents } from "@/lib/money";
import {
  isLowConfidence,
  type ExtractedField,
  type OcrSaveState,
  type OcrUploadState,
} from "@/lib/ocr-schema";
import { formatBasisPoints } from "@/lib/splits";
import { MAX_INVOICE_UPLOAD_BYTES, formatBytes } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import {
  createBillFromExtractionAction,
  extractInvoiceAction,
} from "@/server/actions/ingest";

/**
 * Invoice upload -> extraction -> review -> draft.
 *
 * The review step is the feature, not a formality (ADR 0010). Every extracted
 * value is shown beside the document it came from and is editable before it is
 * saved, and nothing is written until the reviewer presses Save. What lands is
 * always a `DRAFT` with `source = OCR`.
 *
 * The reconciliation strip is deliberately loud. Extracted lines usually do not
 * add up to the extracted total, the total wins (ADR 0004), and the resulting
 * draft is `Missing info` on purpose — so the UI explains that rather than
 * hiding it.
 */

export interface VendorOption {
  id: string;
  name: string;
}

export interface GlAccountOption {
  id: string;
  code: string;
  name: string;
}

export interface InvoiceUploadFormProps {
  vendors: VendorOption[];
  glAccounts: GlAccountOption[];
  providerLabel: string;
  geminiConfigured: boolean;
}

const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.webp,.heic";

export function InvoiceUploadForm({
  vendors,
  glAccounts,
  providerLabel,
  geminiConfigured,
}: InvoiceUploadFormProps) {
  const [uploadState, uploadAction, extracting] = useActionState<OcrUploadState, FormData>(
    extractInvoiceAction,
    { status: "idle" },
  );
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [runId, setRunId] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URL for the side-by-side viewer. The demo does not store uploaded
  // bytes, so the document is only visible while the reviewer is on this page.
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setDocumentUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setDocumentUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // A fresh extraction must reset the review form, so it is remounted by key
  // rather than patched with effects.
  useEffect(() => {
    if (uploadState.status === "ready") setRunId((current) => current + 1);
  }, [uploadState]);

  // The server re-checks this; catching it here saves the reviewer a round trip
  // that would otherwise be spent uploading a file we already know is too large.
  const oversize = file !== null && file.size > MAX_INVOICE_UPLOAD_BYTES;

  const pickFile = (next: File | null) => {
    setFile(next);
    if (inputRef.current && next) {
      const transfer = new DataTransfer();
      transfer.items.add(next);
      inputRef.current.files = transfer.files;
    }
  };

  return (
    <div className="space-y-5">
      <form action={uploadAction} className="space-y-3">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) pickFile(dropped);
          }}
          className={cn(
            "rounded-xl border border-dashed p-8 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border bg-card",
          )}
        >
          <span className="bg-muted text-muted-foreground mx-auto mb-3 flex size-10 items-center justify-center rounded-lg">
            <Upload className="size-5" />
          </span>
          <p className="text-sm font-medium">
            Drag an invoice document here, or choose a file
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            PDF or image, up to {formatBytes(MAX_INVOICE_UPLOAD_BYTES)}. The extraction is a
            starting point for review — it always lands as a draft, never as a finished bill.
          </p>

          <input
            ref={inputRef}
            type="file"
            name="document"
            accept={ACCEPTED_TYPES}
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              <FileText />
              Choose a file
            </Button>
            <Button type="submit" size="sm" disabled={!file || oversize || extracting}>
              {extracting ? <Loader2 className="animate-spin" /> : <ScanLine />}
              {extracting ? "Reading the document…" : "Extract invoice"}
            </Button>
          </div>

          {file ? (
            <p
              className={cn(
                "mt-3 font-mono text-xs",
                oversize ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {file.name} · {formatBytes(file.size)}
            </p>
          ) : null}

          {oversize ? (
            <p className="text-destructive mt-1 text-xs">
              That document is larger than the {formatBytes(MAX_INVOICE_UPLOAD_BYTES)} limit. Choose
              a smaller file, or split the scan.
            </p>
          ) : null}
        </div>

        <p className="text-muted-foreground text-xs">
          <Sparkles className="mr-1 inline size-3" />
          Extractor: {providerLabel}
          {geminiConfigured
            ? ""
            : " — the product runs end to end without an API key, on a deterministic reading of the file."}
        </p>
      </form>

      {extracting ? (
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Reading the document</p>
              <p className="text-muted-foreground text-sm">
                Structured extraction takes a few seconds. Nothing is written until you
                review it.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {uploadState.status === "error" ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>The document could not be scanned</AlertTitle>
          <AlertDescription>{uploadState.message}</AlertDescription>
        </Alert>
      ) : null}

      {uploadState.status === "ready" && !extracting ? (
        <ExtractionReview
          key={runId}
          ready={uploadState}
          vendors={vendors}
          glAccounts={glAccounts}
          documentUrl={documentUrl}
          documentType={file?.type ?? ""}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

type ReadyState = Extract<OcrUploadState, { status: "ready" }>;

interface DraftLine {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  glAccountId: string;
  department: string;
}

interface ExtractionReviewProps {
  ready: ReadyState;
  vendors: VendorOption[];
  glAccounts: GlAccountOption[];
  documentUrl: string | null;
  documentType: string;
}

function ExtractionReview({
  ready,
  vendors,
  glAccounts,
  documentUrl,
  documentType,
}: ExtractionReviewProps) {
  const [saveState, saveAction, saving] = useActionState<OcrSaveState, FormData>(
    createBillFromExtractionAction,
    { status: "idle" },
  );

  const { envelope, vendorCandidates, suggestedVendorId, documentFileName } = ready;
  const result = envelope.result;
  const currency = result.currency;

  const [vendorId, setVendorId] = useState(suggestedVendorId ?? "");
  const [billNumber, setBillNumber] = useState(result.fields.billNumber.value ?? "");
  const [issueDate, setIssueDate] = useState(result.fields.issueDate.value ?? "");
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(
    result.fields.paymentTerms.value ?? "NET_30",
  );
  const [totalAmount, setTotalAmount] = useState(
    result.fields.totalCents.value !== null
      ? formatCents(result.fields.totalCents.value, { currency, showSymbol: false })
      : "",
  );
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() =>
    result.lineItems.map((line, index) => ({
      key: `line-${index}`,
      description: line.description,
      quantity: String(line.quantity),
      unitPrice: formatCents(line.unitPriceCents, { currency, showSymbol: false }),
      glAccountId: "",
      department: "",
    })),
  );

  const totalCents = parseAmountToCents(totalAmount, currency);
  const lineTotalCents = useMemo(
    () =>
      sumCents(
        lines.map((line) =>
          lineAmountCents(
            Math.max(1, Number(line.quantity) || 1),
            parseAmountToCents(line.unitPrice, currency) ?? 0,
          ),
        ),
      ),
    [lines, currency],
  );
  const differenceCents = totalCents === null ? 0 : lineTotalCents - totalCents;
  const reconciles = totalCents !== null && differenceCents === 0;

  const issue = fromDateInputValue(issueDate);
  const dueDate = issue ? dueDateFrom(issue, paymentTerms) : null;

  const linesPayload = useMemo(
    () =>
      JSON.stringify(
        lines.map((line) => ({
          description: line.description,
          quantity: Math.max(1, Number(line.quantity) || 1),
          unitPrice: line.unitPrice,
          glAccountId: line.glAccountId || null,
          department: line.department || null,
        })),
      ),
    [lines],
  );

  const fieldErrors = saveState.status === "error" ? (saveState.fieldErrors ?? {}) : {};

  if (saveState.status === "saved") {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-600" />
            <p className="text-sm font-medium">
              Draft created for {saveState.vendorName} · {saveState.billNumber}
            </p>
          </div>
          <p className="text-muted-foreground text-sm">
            It is a draft with source <span className="font-mono">OCR</span>, and the
            extraction was saved alongside it so the reading stays auditable. Finish the
            coding on the bill before submitting it for approval.
          </p>
          <Button asChild size="sm">
            <Link href={`/bills/${saveState.billId}`}>
              Open the draft
              <ArrowRight />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form action={saveAction} className="space-y-5">
      <input type="hidden" name="envelope" value={JSON.stringify(envelope)} />
      <input type="hidden" name="lines" value={linesPayload} />
      <input type="hidden" name="documentFileName" value={documentFileName} />
      <input type="hidden" name="currency" value={currency} />

      <Alert>
        <ScanLine />
        <AlertTitle>
          Read by {envelope.model}
          {envelope.confidenceBasisPoints !== null
            ? ` · ${formatBasisPoints(envelope.confidenceBasisPoints)} overall confidence`
            : ""}
        </AlertTitle>
        <AlertDescription>
          Check every field against the document before saving. What you save is a draft —
          it is never submitted for approval on your behalf.
        </AlertDescription>
      </Alert>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <DocumentViewer
            url={documentUrl}
            fileName={documentFileName}
            type={documentType}
          />
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Bill details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="ocr-vendor">Vendor</Label>
                  <ConfidenceBadge field={result.fields.vendorName} />
                </div>
                <Select name="vendorId" value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger id="ocr-vendor" className="w-full">
                    <SelectValue placeholder="Pick the vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {orderVendors(vendors, vendorCandidates).map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        {vendor.name}
                        {vendorCandidates.some((candidate) => candidate.id === vendor.id)
                          ? "  · suggested"
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldNote
                  extracted={result.fields.vendorName.value ?? "nothing"}
                  error={fieldErrors.vendorId}
                  hint={
                    suggestedVendorId
                      ? "Matched to an existing vendor — confirm it is the right one."
                      : "No confident match. Pick the vendor; an extraction never creates one."
                  }
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="ocr-bill-number">Bill number</Label>
                    <ConfidenceBadge field={result.fields.billNumber} />
                  </div>
                  <Input
                    id="ocr-bill-number"
                    name="billNumber"
                    value={billNumber}
                    onChange={(event) => setBillNumber(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.billNumber)}
                  />
                  <FieldNote
                    extracted={result.fields.billNumber.value ?? "nothing"}
                    error={fieldErrors.billNumber}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="ocr-total">Total ({currency})</Label>
                    <ConfidenceBadge field={result.fields.totalCents} />
                  </div>
                  <Input
                    id="ocr-total"
                    name="totalAmount"
                    inputMode="decimal"
                    value={totalAmount}
                    onChange={(event) => setTotalAmount(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.totalAmount)}
                  />
                  <FieldNote
                    extracted={
                      result.fields.totalCents.value !== null
                        ? formatCents(result.fields.totalCents.value, { currency })
                        : "nothing"
                    }
                    error={fieldErrors.totalAmount}
                    hint="This is the amount owed. Line items code it; they never change it."
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="ocr-issue-date">Issue date</Label>
                    <ConfidenceBadge field={result.fields.issueDate} />
                  </div>
                  <Input
                    id="ocr-issue-date"
                    name="issueDate"
                    type="date"
                    value={issueDate}
                    onChange={(event) => setIssueDate(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.issueDate)}
                  />
                  <FieldNote
                    extracted={result.fields.issueDate.value ?? "nothing"}
                    error={fieldErrors.issueDate}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="ocr-terms">Payment terms</Label>
                    <ConfidenceBadge field={result.fields.paymentTerms} />
                  </div>
                  <Select
                    name="paymentTerms"
                    value={paymentTerms}
                    onValueChange={(value) => setPaymentTerms(value as PaymentTerms)}
                  >
                    <SelectTrigger id="ocr-terms" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_TERMS.map((terms) => (
                        <SelectItem key={terms} value={terms}>
                          {PAYMENT_TERMS_LABELS[terms]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldNote
                    extracted={
                      result.fields.dueDate.value
                        ? `due ${result.fields.dueDate.value}`
                        : "nothing"
                    }
                    error={fieldErrors.paymentTerms}
                    hint={
                      dueDate
                        ? `Due ${formatDate(dueDate)} — derived from the issue date and terms.`
                        : undefined
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ocr-memo">Memo</Label>
                <Textarea
                  id="ocr-memo"
                  name="memo"
                  rows={2}
                  value={memo}
                  placeholder="Optional note for whoever reviews this bill"
                  onChange={(event) => setMemo(event.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Extracted line items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lines.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No lines were read. Add at least one so the spend can be coded.
                </p>
              ) : null}

              {lines.map((line, index) => (
                <div
                  key={line.key}
                  className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_auto]"
                >
                  <Input
                    aria-label={`Line ${index + 1} description`}
                    value={line.description}
                    onChange={(event) =>
                      updateLine(setLines, line.key, { description: event.target.value })
                    }
                  />
                  <Input
                    aria-label={`Line ${index + 1} quantity`}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(event) =>
                      updateLine(setLines, line.key, { quantity: event.target.value })
                    }
                  />
                  <Input
                    aria-label={`Line ${index + 1} unit price`}
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(event) =>
                      updateLine(setLines, line.key, { unitPrice: event.target.value })
                    }
                  />
                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    <span className="text-sm tabular-nums">
                      {formatCents(
                        lineAmountCents(
                          Math.max(1, Number(line.quantity) || 1),
                          parseAmountToCents(line.unitPrice, currency) ?? 0,
                        ),
                        { currency },
                      )}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((entry) => entry.key !== line.key),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  <div className="sm:col-span-4 grid gap-2 sm:grid-cols-2">
                    <Select
                      value={line.glAccountId}
                      onValueChange={(value) =>
                        updateLine(setLines, line.key, { glAccountId: value })
                      }
                    >
                      <SelectTrigger className="w-full" aria-label={`Line ${index + 1} GL account`}>
                        <SelectValue placeholder="GL account (needed before approval)" />
                      </SelectTrigger>
                      <SelectContent>
                        {glAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.code} · {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label={`Line ${index + 1} department`}
                      placeholder="Department (optional)"
                      value={line.department}
                      onChange={(event) =>
                        updateLine(setLines, line.key, { department: event.target.value })
                      }
                    />
                  </div>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    {
                      key: `line-${Date.now()}`,
                      description: "",
                      quantity: "1",
                      unitPrice: "",
                      glAccountId: "",
                      department: "",
                    },
                  ])
                }
              >
                <Plus />
                Add a line
              </Button>

              <Separator />

              <ReconciliationStrip
                currency={currency}
                totalCents={totalCents}
                lineTotalCents={lineTotalCents}
                differenceCents={differenceCents}
                reconciles={reconciles}
              />
            </CardContent>
          </Card>

          {result.warnings.length > 0 ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle>What the extractor flagged</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {saveState.status === "error" ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>The draft was not saved</AlertTitle>
              <AlertDescription>{saveState.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save as draft
            </Button>
            <p className="text-muted-foreground text-xs">
              Creates a draft with source <span className="font-mono">OCR</span> and keeps
              this run as an auditable extraction.
            </p>
          </div>

          <AttemptTrail envelope={envelope} />
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function DocumentViewer({
  url,
  fileName,
  type,
}: {
  url: string | null;
  fileName: string;
  type: string;
}) {
  const isImage = type.startsWith("image/");

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="truncate font-mono text-xs">{fileName}</CardTitle>
      </CardHeader>
      <CardContent>
        {url ? (
          isImage ? (
            /* A blob: URL from the reviewer's own file — next/image cannot
               optimise it, and there is nothing to optimise. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={`Invoice document ${fileName}`}
              className="h-[70vh] w-full rounded-md border object-contain"
            />
          ) : (
            <iframe
              src={url}
              title={`Invoice document ${fileName}`}
              className="h-[70vh] w-full rounded-md border"
            />
          )
        ) : (
          <p className="text-muted-foreground text-sm">
            The document is not available for preview.
          </p>
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          The demo does not store uploaded files. The bill records the file name, and
          links to the document only when one of the bundled sample invoices was used.
        </p>
      </CardContent>
    </Card>
  );
}

function ReconciliationStrip({
  currency,
  totalCents,
  lineTotalCents,
  differenceCents,
  reconciles,
}: {
  currency: string;
  totalCents: number | null;
  lineTotalCents: number;
  differenceCents: number;
  reconciles: boolean;
}) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Line items</span>
        <span className="tabular-nums">{formatCents(lineTotalCents, { currency })}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Bill total (authoritative)</span>
        <span className="font-medium tabular-nums">
          {totalCents === null ? "—" : formatCents(totalCents, { currency })}
        </span>
      </div>
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-md px-2 py-1.5",
          reconciles
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
            : "bg-orange-50 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
        )}
      >
        <span>{reconciles ? "Coding balances" : "Out by"}</span>
        <span className="font-medium tabular-nums">
          {reconciles ? "—" : formatCents(differenceCents, { currency })}
        </span>
      </div>
      {!reconciles ? (
        <p className="text-muted-foreground text-xs">
          The bill total is what is owed; the lines exist to code it. Saving is fine — the
          draft will read <strong>Missing info</strong> until the coding adds up, and it
          cannot be submitted for approval before then.
        </p>
      ) : null}
    </div>
  );
}

function ConfidenceBadge({ field }: { field: ExtractedField<unknown> }) {
  if (field.confidenceBasisPoints === null) return null;
  const low = isLowConfidence(field.confidenceBasisPoints);
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px]",
        low
          ? "border-orange-300 text-orange-800 dark:border-orange-800/60 dark:text-orange-300"
          : "text-muted-foreground",
      )}
    >
      {formatBasisPoints(field.confidenceBasisPoints)}
      {low ? " · check" : ""}
    </Badge>
  );
}

function FieldNote({
  extracted,
  hint,
  error,
}: {
  extracted: string;
  hint?: string;
  error?: string;
}) {
  if (error) return <p className="text-destructive text-xs">{error}</p>;
  return (
    <p className="text-muted-foreground text-xs">
      Read: <span className="font-mono">{extracted}</span>
      {hint ? ` — ${hint}` : ""}
    </p>
  );
}

function AttemptTrail({ envelope }: { envelope: ReadyState["envelope"] }) {
  if (envelope.attempts.length === 0) return null;
  return (
    <details className="text-muted-foreground text-xs">
      <summary className="cursor-pointer">How this was read</summary>
      <ul className="mt-2 space-y-1 pl-4">
        {envelope.attempts.map((attempt) => (
          <li key={`${attempt.provider}:${attempt.model}:${attempt.ok}`}>
            <span className="font-mono">{attempt.model}</span> —{" "}
            {attempt.ok ? `read the document in ${attempt.durationMs} ms` : attempt.error}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateLine(
  setLines: Dispatch<SetStateAction<DraftLine[]>>,
  key: string,
  patch: Partial<DraftLine>,
) {
  setLines((current) =>
    current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
  );
}

/** Suggested vendors first, then the rest alphabetically. */
function orderVendors(
  vendors: VendorOption[],
  candidates: ReadyState["vendorCandidates"],
): VendorOption[] {
  const candidateIds = candidates.map((candidate) => candidate.id);
  const suggested = candidateIds
    .map((id) => vendors.find((vendor) => vendor.id === id))
    .filter((vendor): vendor is VendorOption => vendor !== undefined);
  const rest = vendors.filter((vendor) => !candidateIds.includes(vendor.id));
  return [...suggested, ...rest];
}
