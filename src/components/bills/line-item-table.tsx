"use client";

/**
 * The coding surface: line items, their GL coding, their splits, and the
 * reconciliation against the authoritative bill total.
 *
 * ADR 0004 in one sentence: **the header total is what is owed; line items
 * exist to code that spend.** So this component shows Σ(line items) beside
 * `bill.totalCents` and names the difference out loud — it never edits the
 * total to make the arithmetic quiet.
 *
 * All money is integer cents (`@/lib/money`); all split arithmetic is
 * delegated to `@/lib/splits` through `<LineItemSplits/>`.
 */

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ListPlus,
  Pencil,
  Plus,
  Scale,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { GlAccount } from "@prisma/client";

import { LineItemSplits } from "@/components/bills/line-item-splits";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BILL_STATUS_META } from "@/lib/bill-status";
import { formatCents, lineAmountCents, parseAmountToCents, sumCents } from "@/lib/money";
import { basisPointsOf, formatBasisPoints } from "@/lib/splits";
import { cn } from "@/lib/utils";
import {
  createLineItem,
  deleteLineItem,
  updateLineItem,
  type AllocationTemplateOption,
  type LineItemInput,
} from "@/server/actions/bill-edit";
import type { BillDetail, BillDetailLineItem } from "@/server/bill-detail";

export interface LineItemTableProps {
  bill: BillDetail;
  glAccounts: GlAccount[];
  templates: AllocationTemplateOption[];
}

/** Radix Select cannot hold an empty string, so "uncoded" needs a sentinel. */
const NO_GL_ACCOUNT = "__none__";

const LINE_TYPE_LABELS: Record<string, string> = {
  EXPENSE: "Expense",
  ITEM: "Item",
};

export function LineItemTable({
  bill,
  glAccounts,
  templates,
}: LineItemTableProps) {
  const [adding, setAdding] = useState(false);

  const editable = bill.status === "DRAFT" || bill.status === "REJECTED";
  const currency = bill.currency;
  const lines = bill.lineItems;

  const linesTotalCents = sumCents(lines.map((line) => line.amountCents));
  // Signed the way an accountant reads it: positive means the coding is short
  // of what is owed.
  const differenceCents = bill.totalCents - linesTotalCents;
  const balanced = differenceCents === 0 && lines.length > 0;

  const departments = Array.from(
    new Set(
      [
        ...lines.map((line) => line.department),
        ...lines.flatMap((line) => line.splits.map((split) => split.department)),
        ...templates.flatMap((template) =>
          template.rows.map((row) => row.department),
        ),
      ].filter((value): value is string => Boolean(value)),
    ),
  ).sort();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Line items</p>
            <span className="text-muted-foreground text-xs">
              {lines.length} {lines.length === 1 ? "line" : "lines"} coding{" "}
              {formatCents(bill.totalCents, { currency })}
            </span>
          </div>
          {editable ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAdding(true)}
              disabled={adding}
            >
              <Plus /> Add line
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">
              {BILL_STATUS_META[bill.status].label} — coding is locked
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pb-(--card-spacing)">
        {lines.length === 0 && !adding ? (
          <EmptyState
            icon={ListPlus}
            title="Nothing is coded yet"
            description="A bill needs at least one line item. The simplest bill is a single line for the full total."
            action={
              editable ? (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus /> Add the first line
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y">
            {lines.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                currency={currency}
                editable={editable}
                glAccounts={glAccounts}
                templates={templates}
                departments={departments}
              />
            ))}
          </ul>
        )}

        {adding ? (
          <div className="rounded-lg border p-3">
            <p className="mb-3 text-sm font-medium">New line item</p>
            <LineForm
              currency={currency}
              glAccounts={glAccounts}
              departments={departments}
              initial={suggestedNewLine(bill, linesTotalCents)}
              submitLabel="Add line"
              onCancel={() => setAdding(false)}
              onSubmit={async (input) => {
                const result = await createLineItem(bill.id, input);
                if (result.ok) {
                  toast.success("Line item added");
                  setAdding(false);
                }
                return result;
              }}
            />
          </div>
        ) : null}

        <Reconciliation
          currency={currency}
          lineCount={lines.length}
          linesTotalCents={linesTotalCents}
          billTotalCents={bill.totalCents}
          differenceCents={differenceCents}
          balanced={balanced}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// One line
// ---------------------------------------------------------------------------

function LineRow({
  line,
  currency,
  editable,
  glAccounts,
  templates,
  departments,
}: {
  line: BillDetailLineItem;
  currency: string;
  editable: boolean;
  glAccounts: GlAccount[];
  templates: AllocationTemplateOption[];
  departments: string[];
}) {
  // Editing the line and splitting it are INDEPENDENT, not three exclusive
  // modes. They used to be one `view | edit | split` switch, which hid the
  // split affordance from the one person most likely to want it: whoever is
  // already editing the line's coding. Splits are a headline feature — the
  // entry point has to be reachable from wherever the user already is.
  const [editing, setEditing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [pending, startTransition] = useTransition();

  const isSplit = line.splits.length > 0;

  function remove() {
    startTransition(async () => {
      const result = await deleteLineItem(line.id);
      if (result.ok) {
        toast.success("Line item removed");
      } else {
        toast.error(result.error);
      }
    });
  }

  const splitButton = editable ? (
    <SplitButton
      open={splitting}
      isSplit={isSplit}
      onClick={() => setSplitting((current) => !current)}
    />
  ) : null;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="space-y-2">
        {editing ? (
          <div className="space-y-2">
            <LineForm
              currency={currency}
              glAccounts={glAccounts}
              departments={departments}
              initial={{
                description: line.description,
                quantity: line.quantity,
                unitPriceAmount: centsToText(line.unitPriceCents, currency),
                glAccountId: line.glAccountId,
                department: line.department,
                lineType: line.lineType === "ITEM" ? "ITEM" : "EXPENSE",
              }}
              submitLabel="Save line"
              note={
                isSplit
                  ? "This line is split. Changing the amount re-spreads percentage splits automatically; fixed-amount splits have to be rebalanced by hand."
                  : undefined
              }
              onCancel={() => setEditing(false)}
              onSubmit={async (input) => {
                const result = await updateLineItem(line.id, input);
                if (result.ok) {
                  toast.success("Line item updated");
                  setEditing(false);
                }
                return result;
              }}
            />
            {/* The same entry point, offered where someone editing the coding
                will actually look for it. */}
            {splitButton ? (
              <div className="flex items-center justify-end gap-2">
                <span className="text-muted-foreground text-xs">
                  Coding this line to more than one account?
                </span>
                {splitButton}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{line.description}</p>
                <Badge variant="secondary" className="font-normal">
                  {LINE_TYPE_LABELS[line.lineType] ?? line.lineType}
                </Badge>
              </div>
              <p className="text-muted-foreground text-xs tabular-nums">
                {line.quantity} ×{" "}
                {formatCents(line.unitPriceCents, { currency })}
              </p>
              <Coding
                line={line}
                currency={currency}
                editable={editable}
                onExpand={() => setSplitting(true)}
              />
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <p className="text-sm font-semibold tabular-nums">
                {formatCents(line.amountCents, { currency })}
              </p>
              {editable ? (
                <div className="flex items-center gap-1">
                  {splitButton}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title="Edit this line"
                    aria-label="Edit this line"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title="Remove this line"
                    aria-label="Remove this line"
                    disabled={pending}
                    onClick={remove}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {splitting ? (
          <LineItemSplits
            line={line}
            glAccounts={glAccounts}
            templates={templates}
            departments={departments}
            currency={currency}
            onClose={() => setSplitting(false)}
          />
        ) : null}
      </div>
    </li>
  );
}

/**
 * The way into the splits editor.
 *
 * Deliberately labelled rather than icon-only: splits are one of the features
 * this product is judged on, and an unlabelled scale icon reads as decoration.
 * Two people in a row failed to find it when it was an icon.
 */
function SplitButton({
  open,
  isSplit,
  onClick,
}: {
  open: boolean;
  isSplit: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={open ? "secondary" : "outline"}
      size="xs"
      onClick={onClick}
      title={
        isSplit
          ? "Edit how this line is distributed across GL accounts"
          : "Distribute this line across several GL accounts"
      }
    >
      {open ? <ChevronDown /> : <Scale />}
      {open ? "Close split" : isSplit ? "Edit split" : "Split line"}
    </Button>
  );
}

/**
 * How the line is coded. Zero splits → the line's own GL account. One or more
 * splits → the splits carry the coding, so they are what is shown.
 */
function Coding({
  line,
  currency,
  editable,
  onExpand,
}: {
  line: BillDetailLineItem;
  currency: string;
  editable: boolean;
  onExpand: () => void;
}) {
  if (line.splits.length === 0) {
    if (!line.glAccountId || !line.glAccount) {
      return (
        <Badge
          variant="outline"
          className="border-orange-300 bg-orange-50 font-normal text-orange-800 dark:border-orange-800/60 dark:bg-orange-950/60 dark:text-orange-300"
        >
          <AlertTriangle className="size-3" />
          No GL account
        </Badge>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="font-normal">
          <span className="font-mono text-[11px]">{line.glAccount.code}</span>
          {line.glAccount.name}
        </Badge>
        {line.department ? (
          <span className="text-muted-foreground text-xs">
            {line.department}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onExpand}
      className="hover:bg-muted/60 -mx-1 flex w-full flex-col gap-1 rounded-md px-1 py-0.5 text-left transition-colors"
    >
      {/* Says outright that the splits — not the line's own GL account — carry
          the coding, and that clicking opens them. */}
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        <Scale className="size-3" />
        Coded by {line.splits.length} splits, not a single account
        {editable ? (
          <span className="text-primary underline decoration-dotted underline-offset-2">
            edit
          </span>
        ) : null}
      </span>
      <span className="flex flex-wrap gap-1.5">
        {line.splits.map((split) => {
          const bp =
            split.percentBasisPoints ??
            basisPointsOf(split.amountCents, line.amountCents);
          return (
            <Badge key={split.id} variant="outline" className="font-normal">
              <span className="font-mono text-[11px]">
                {split.glAccount.code}
              </span>
              {split.department ?? split.glAccount.name}
              <span className="text-muted-foreground tabular-nums">
                {bp === null ? "" : formatBasisPoints(bp)} ·{" "}
                {formatCents(split.amountCents, { currency })}
              </span>
            </Badge>
          );
        })}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------------

function LineForm({
  currency,
  glAccounts,
  departments,
  initial,
  submitLabel,
  note,
  onCancel,
  onSubmit,
}: {
  currency: string;
  glAccounts: GlAccount[];
  departments: string[];
  initial: LineItemInput;
  submitLabel: string;
  note?: string;
  onCancel: () => void;
  onSubmit: (input: LineItemInput) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState(initial.description);
  const [lineType, setLineType] = useState<"EXPENSE" | "ITEM">(initial.lineType);
  const [quantity, setQuantity] = useState(String(initial.quantity));
  const [unitPriceAmount, setUnitPriceAmount] = useState(initial.unitPriceAmount);
  const [glAccountId, setGlAccountId] = useState(
    initial.glAccountId ?? NO_GL_ACCOUNT,
  );
  const [department, setDepartment] = useState(initial.department ?? "");

  // Amount is DERIVED, never typed: the schema denormalises quantity × unit
  // price, and a second editable amount would be a second source of truth
  // inside a single line.
  const parsedQuantity = Number.parseInt(quantity, 10);
  const parsedUnitPrice = parseAmountToCents(unitPriceAmount, currency);
  const amountCents =
    Number.isInteger(parsedQuantity) && parsedUnitPrice !== null
      ? lineAmountCents(parsedQuantity, parsedUnitPrice)
      : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onSubmit({
        description,
        quantity: Number.parseInt(quantity, 10),
        unitPriceAmount,
        glAccountId: glAccountId === NO_GL_ACCOUNT ? null : glAccountId,
        department: department.trim() || null,
        lineType,
      });
      if (!result.ok) setError(result.error ?? "Could not save that line.");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="space-y-1.5 sm:col-span-4">
          <Label htmlFor="line-description">Description</Label>
          <Input
            id="line-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this line pays for"
            required
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="line-type">Type</Label>
          <Select
            value={lineType}
            onValueChange={(value) => setLineType(value as "EXPENSE" | "ITEM")}
          >
            <SelectTrigger id="line-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EXPENSE">Expense</SelectItem>
              <SelectItem value="ITEM">Item</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="line-quantity">Quantity</Label>
          <Input
            id="line-quantity"
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="text-right tabular-nums"
            required
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="line-unit-price">Unit price</Label>
          <Input
            id="line-unit-price"
            inputMode="decimal"
            value={unitPriceAmount}
            onChange={(event) => setUnitPriceAmount(event.target.value)}
            className="text-right tabular-nums"
            required
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>Amount</Label>
          <div className="flex h-8 items-center justify-end rounded-lg border border-dashed px-2.5 text-sm font-medium tabular-nums">
            {amountCents === null
              ? "—"
              : formatCents(amountCents, { currency })}
          </div>
        </div>

        <div className="space-y-1.5 sm:col-span-4">
          <Label htmlFor="line-gl">GL account</Label>
          <Select value={glAccountId} onValueChange={setGlAccountId}>
            <SelectTrigger id="line-gl" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GL_ACCOUNT}>Not coded yet</SelectItem>
              {glAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  <span className="font-mono text-xs">{account.code}</span>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="line-department">Department</Label>
          <Input
            id="line-department"
            value={department}
            list="billpay-departments-line"
            placeholder="Optional"
            onChange={(event) => setDepartment(event.target.value)}
          />
          <datalist id="billpay-departments-line">
            {departments.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </div>
      </div>

      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}

      {error ? (
        <p className="text-destructive flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          <X /> Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Reconciliation — ADR 0004 made visible
// ---------------------------------------------------------------------------

function Reconciliation({
  currency,
  lineCount,
  linesTotalCents,
  billTotalCents,
  differenceCents,
  balanced,
}: {
  currency: string;
  lineCount: number;
  linesTotalCents: number;
  billTotalCents: number;
  differenceCents: number;
  balanced: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm",
        balanced
          ? "border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/40"
          : "border-orange-300/70 bg-orange-50/60 dark:border-orange-800/60 dark:bg-orange-950/40",
      )}
    >
      <dl className="space-y-1">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">
            Σ line items{lineCount ? ` (${lineCount})` : ""}
          </dt>
          <dd className="font-medium tabular-nums">
            {formatCents(linesTotalCents, { currency })}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">
            Bill total{" "}
            <span className="text-[11px] uppercase">· authoritative</span>
          </dt>
          <dd className="font-medium tabular-nums">
            {formatCents(billTotalCents, { currency })}
          </dd>
        </div>
      </dl>

      <div className="mt-2 flex items-start gap-2 border-t pt-2">
        {balanced ? (
          <>
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-emerald-900 dark:text-emerald-200">
              The coding reconciles to the bill total.
            </p>
          </>
        ) : (
          <>
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-400" />
            <div className="min-w-0">
              <p className="font-medium text-orange-900 dark:text-orange-200">
                {formatCents(Math.abs(differenceCents), { currency })}{" "}
                {differenceCents > 0 ? "not yet coded" : "coded above the total"}
              </p>
              <p className="text-orange-900/80 dark:text-orange-200/80">
                The bill total is what is owed to the vendor and is never
                rewritten from the lines. Adjust the lines — or the total, if
                the invoice really says otherwise.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Prefill a new line with whatever is still uncoded, so the common case — a
 * bill that needs one line for its whole total — is a single click away.
 */
function suggestedNewLine(
  bill: BillDetail,
  linesTotalCents: number,
): LineItemInput {
  const remaining = bill.totalCents - linesTotalCents;
  return {
    description: bill.lineItems.length === 0 ? (bill.memo ?? "") : "",
    quantity: 1,
    unitPriceAmount: centsToText(
      remaining > 0 ? remaining : 0,
      bill.currency,
    ),
    glAccountId: null,
    department: null,
    lineType: "EXPENSE",
  };
}

function centsToText(cents: number, currency: string): string {
  return formatCents(cents, { currency, showSymbol: false }).replace(/,/g, "");
}
