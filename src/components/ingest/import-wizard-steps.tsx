"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  IMPORT_COLUMNS,
  buildImportTemplateCsv,
  importColumn,
  type ImportBillDraft,
  type ImportPreviewState,
  type ImportRunState,
} from "@/lib/csv-import";
import { PAYMENT_TERMS_LABELS, formatDate } from "@/lib/dates";
import { formatCents, sumCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { previewBillImportAction, runBillImportAction } from "@/server/actions/ingest";

/**
 * The CSV import wizard: template -> upload -> preview -> import -> summary.
 *
 * The preview step is the point. Nothing is written until the reviewer has seen
 * exactly which bills would be created and, per row, exactly what is wrong with
 * the ones that would not — no partial import ever happens silently.
 *
 * The preview rendered here is advisory: the import action re-parses the
 * original file server-side against fresh reference data before writing.
 */

export interface ImportWizardStepsProps {
  vendorNames: string[];
  glAccounts: { code: string; name: string }[];
}

export function ImportWizardSteps({ vendorNames, glAccounts }: ImportWizardStepsProps) {
  const [previewState, previewAction, previewing] = useActionState<
    ImportPreviewState,
    FormData
  >(previewBillImportAction, { status: "idle" });
  const [runState, runAction, running] = useActionState<ImportRunState, FormData>(
    runBillImportAction,
    { status: "idle" },
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const blob = new Blob([buildImportTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "billpay-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (runState.status === "done") {
    return <ImportSummaryView summary={runState.summary} />;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>1 · Start from the template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            One row per <strong>line item</strong>. Rows that repeat the same vendor and
            bill number become one bill with several lines, so every row of a bill must
            carry the same header values.
          </p>

          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
            <Download />
            Download the CSV template
          </Button>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Column</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>What it holds</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {IMPORT_COLUMNS.map((column) => (
                  <TableRow key={column.key}>
                    <TableCell className="font-mono text-xs">{column.header}</TableCell>
                    <TableCell>
                      {column.required ? (
                        <Badge variant="outline">required</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">optional</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {column.description}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Separator />

          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              Accepted vendors and GL accounts
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium">Vendors</p>
                <ul className="text-muted-foreground space-y-0.5 text-xs">
                  {vendorNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium">
                  GL accounts
                </p>
                <ul className="text-muted-foreground space-y-0.5 text-xs">
                  {glAccounts.map((account) => (
                    <li key={account.code}>
                      <span className="font-mono">{account.code}</span> · {account.name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2 · Upload the file</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={previewAction} className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              name="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              className="sr-only"
              onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              <FileSpreadsheet />
              Choose a CSV
            </Button>
            <Button type="submit" size="sm" disabled={!fileName || previewing}>
              {previewing ? <Loader2 className="animate-spin" /> : <Upload />}
              {previewing ? "Checking every row…" : "Preview the import"}
            </Button>
            {fileName ? (
              <span className="text-muted-foreground font-mono text-xs">{fileName}</span>
            ) : null}
          </form>

          {previewState.status === "error" ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle />
              <AlertTitle>The file could not be read</AlertTitle>
              <AlertDescription>{previewState.message}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {previewState.status === "ready" ? (
        <PreviewStep
          state={previewState}
          runAction={runAction}
          running={running}
          runError={runState.status === "error" ? runState.message : null}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

function PreviewStep({
  state,
  runAction,
  running,
  runError,
}: {
  state: Extract<ImportPreviewState, { status: "ready" }>;
  runAction: (formData: FormData) => void;
  running: boolean;
  runError: string | null;
}) {
  const { preview } = state;

  if (preview.fileErrors.length > 0) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Nothing can be imported from this file</AlertTitle>
        <AlertDescription>
          <ul className="list-disc space-y-1 pl-4">
            {preview.fileErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>3 · Check every row before anything is created</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">{preview.rowCount} rows read</Badge>
          <Badge variant="outline">{preview.bills.length} bills found</Badge>
          <Badge
            variant="outline"
            className="border-emerald-300 text-emerald-800 dark:border-emerald-800/60 dark:text-emerald-300"
          >
            {preview.validCount} will be created
          </Badge>
          {preview.invalidCount > 0 ? (
            <Badge
              variant="outline"
              className="border-red-300 text-red-800 dark:border-red-800/60 dark:text-red-300"
            >
              {preview.invalidCount} blocked
            </Badge>
          ) : null}
        </div>

        {preview.unmappedHeaders.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Ignored columns: {preview.unmappedHeaders.join(", ")}.
          </p>
        ) : null}

        <p className="text-muted-foreground text-xs">
          Read as:{" "}
          {preview.mapping
            .filter((entry) => entry.header !== null)
            .map((entry) => `${entry.header} → ${importColumn(entry.key).header}`)
            .join(", ")}
          .
        </p>

        <div className="space-y-3">
          {preview.bills.map((draft) => (
            <PreviewBillRow key={draft.key} draft={draft} />
          ))}
        </div>

        {runError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>The import did not run</AlertTitle>
            <AlertDescription>{runError}</AlertDescription>
          </Alert>
        ) : null}

        <Separator />

        <form action={runAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="csvText" value={state.csvText} />
          <Button type="submit" disabled={running || preview.validCount === 0}>
            {running ? <Loader2 className="animate-spin" /> : null}
            {running
              ? "Creating drafts…"
              : `Create ${preview.validCount} draft${preview.validCount === 1 ? "" : "s"}`}
          </Button>
          <p className="text-muted-foreground text-xs">
            Blocked bills are skipped and reported — nothing is written for them. Every row
            is validated again on the server before anything is created.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function PreviewBillRow({ draft }: { draft: ImportBillDraft }) {
  const lineTotal = sumCents(draft.lines.map((line) => line.amountCents));
  const balances = draft.totalCents !== null && lineTotal === draft.totalCents;

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        draft.valid ? "" : "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {draft.vendorName} · {draft.billNumber || "(no bill number)"}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="tabular-nums">
            {draft.totalCents === null
              ? "—"
              : formatCents(draft.totalCents, { currency: draft.currency })}
          </span>
          {draft.valid ? (
            <Badge
              variant="outline"
              className="border-emerald-300 text-emerald-800 dark:border-emerald-800/60 dark:text-emerald-300"
            >
              will be created
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-red-300 text-red-800 dark:border-red-800/60 dark:text-red-300"
            >
              blocked
            </Badge>
          )}
        </div>
      </div>

      <p className="text-muted-foreground mt-1 text-xs">
        {draft.issueDate
          ? `Issued ${formatDate(`${draft.issueDate}T00:00:00.000Z`)}`
          : "No issue date"}
        {draft.paymentTerms ? ` · ${PAYMENT_TERMS_LABELS[draft.paymentTerms]}` : ""}
        {draft.dueDate ? ` · due ${formatDate(`${draft.dueDate}T00:00:00.000Z`)}` : ""}
        {" · rows "}
        {draft.sourceLines.join(", ")}
      </p>

      {draft.lines.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-sm">
          {draft.lines.map((line) => (
            <li key={line.line} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                {line.description}
                <span className="text-muted-foreground">
                  {" "}
                  · {line.quantity} ×{" "}
                  {formatCents(line.unitPriceCents, { currency: draft.currency })}
                  {line.glCode ? ` · GL ${line.glCode}` : " · no GL account"}
                </span>
              </span>
              <span className="tabular-nums">
                {formatCents(line.amountCents, { currency: draft.currency })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {!balances && draft.totalCents !== null ? (
        <p className="mt-1 text-xs text-orange-700 dark:text-orange-400">
          Lines sum to {formatCents(lineTotal, { currency: draft.currency })} against a
          total of {formatCents(draft.totalCents, { currency: draft.currency })}. The total
          wins — the draft lands in Missing info.
        </p>
      ) : null}

      {draft.errors.length > 0 ? (
        <ul className="text-destructive mt-2 list-disc space-y-1 pl-4 text-xs">
          {draft.errors.map((issue, index) => (
            <li key={`${issue.line}-${index}`}>
              Row {issue.line}
              {issue.column ? ` · ${importColumn(issue.column).header}` : ""}:{" "}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {draft.warnings.length > 0 ? (
        <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-4 text-xs">
          {draft.warnings.map((issue, index) => (
            <li key={`${issue.line}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function ImportSummaryView({
  summary,
}: {
  summary: Extract<ImportRunState, { status: "done" }>["summary"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import finished</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge
            variant="outline"
            className="border-emerald-300 text-emerald-800 dark:border-emerald-800/60 dark:text-emerald-300"
          >
            {summary.created} created
          </Badge>
          <Badge variant="outline">{summary.skipped} skipped</Badge>
          {summary.failed > 0 ? (
            <Badge
              variant="outline"
              className="border-red-300 text-red-800 dark:border-red-800/60 dark:text-red-300"
            >
              {summary.failed} failed
            </Badge>
          ) : null}
        </div>

        <ul className="divide-border divide-y rounded-lg border text-sm">
          {summary.outcomes.map((outcome) => (
            <li key={`${outcome.vendorName}-${outcome.billNumber}`} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {outcome.status === "CREATED" ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <XCircle className="text-destructive size-4" />
                  )}
                  <span className="font-medium">
                    {outcome.vendorName} · {outcome.billNumber}
                  </span>
                </span>
                {outcome.billId ? (
                  <Button asChild variant="ghost" size="xs">
                    <Link href={`/bills/${outcome.billId}`}>Open the draft</Link>
                  </Button>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {outcome.status === "SKIPPED" ? "skipped" : "failed"}
                  </span>
                )}
              </div>
              {outcome.reasons.length > 0 ? (
                <ul
                  className={cn(
                    "mt-1 list-disc space-y-0.5 pl-6 text-xs",
                    outcome.status === "CREATED"
                      ? "text-muted-foreground"
                      : "text-destructive",
                  )}
                >
                  {outcome.reasons.map((reason, index) => (
                    <li key={`${reason}-${index}`}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="sm">
            <Link href="/bills">Go to the bills inbox</Link>
          </Button>
          <p className="text-muted-foreground text-xs">
            Imported bills are drafts with source <span className="font-mono">CSV</span>.
            Code the lines and resolve any Missing info before submitting them.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
