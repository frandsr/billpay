"use client";

/**
 * Bill header — the identity of the payable record and its derived state.
 *
 * Two things this panel exists to say out loud:
 *
 *  * **`totalCents` is authoritative** (ADR 0004). The total shown here is what
 *    is owed to the vendor. Line items code the spend; they never redefine it.
 *  * **`Missing info` / `Ready` are derived, never stored.** The panel does not
 *    just show that a draft is blocked, it lists exactly *what* is missing, from
 *    `draftReadinessDetail`.
 *
 * Editing is offered only for `DRAFT` and `REJECTED` bills, and the server
 * action enforces the same rule — hiding a button is not a validation.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Pencil,
  Repeat,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { User } from "@prisma/client";

import { UserAvatar } from "@/components/shell/user-avatar";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  BILL_STATUS_META,
  DRAFT_READINESS_META,
  draftReadinessDetail,
} from "@/lib/bill-status";
import {
  PAYMENT_TERMS_LABELS,
  daysOverdue,
  formatDate,
  formatDueDistance,
  toDateInputValue,
} from "@/lib/dates";
import { PAYMENT_TERMS } from "@/lib/domain";
import { formatCents } from "@/lib/money";
import { DUE_DATE_RELEVANT_STATUSES } from "@/lib/outstanding";
import { cn } from "@/lib/utils";
import { updateBillHeader } from "@/server/actions/bill-edit";
import type { BillDetail } from "@/server/bill-detail";

export interface BillHeaderProps {
  bill: BillDetail;
  currentUser: User;
}

/** Currencies `formatCents` knows how to render. */
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "MXN"] as const;

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "entered manually",
  OCR: "scanned from the invoice",
  CSV: "imported from CSV",
  EMAIL: "forwarded by email",
  RECURRING: "created on a schedule",
};


export function BillHeader({ bill, currentUser }: BillHeaderProps) {
  const [editing, setEditing] = useState(false);

  const statusMeta = BILL_STATUS_META[bill.status];
  const readiness = draftReadinessDetail(bill);
  const editable = bill.status === "DRAFT" || bill.status === "REJECTED";
  const overdue = daysOverdue(bill.dueDate);
  const showOverdue = overdue > 0 && DUE_DATE_RELEVANT_STATUSES.includes(bill.status);

  const creator =
    bill.createdById === currentUser.id ? "you" : bill.createdBy.name;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl leading-tight font-semibold">
                {bill.vendor.name}
              </h1>
              <Badge
                variant={statusMeta.badgeVariant}
                className={statusMeta.badgeClassName}
                title={statusMeta.description}
              >
                {statusMeta.label}
              </Badge>
              {bill.status === "DRAFT" ? (
                <ReadinessBadge state={readiness.state} />
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm">
              Invoice{" "}
              <span className="text-foreground font-mono">
                {bill.billNumber}
              </span>{" "}
              · {SOURCE_LABELS[bill.source] ?? "entered manually"} by {creator}
              {/* Provenance the bill already carried but never showed: the
                  template that generated it, linked so the reviewer can go
                  read the schedule that will produce the next one. */}
              {bill.recurringBill ? (
                <>
                  {" · "}
                  <Link
                    href={`/recurring/${bill.recurringBill.id}`}
                    className="hover:text-foreground underline decoration-dotted underline-offset-4"
                  >
                    <Repeat className="mr-1 inline size-3 align-[-0.1em]" aria-hidden />
                    Generated from “{bill.recurringBill.name}”
                  </Link>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex items-start gap-4">
            <div className="text-right">
              <p className="text-2xl leading-none font-semibold tabular-nums">
                {formatCents(bill.totalCents, { currency: bill.currency })}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {bill.currency} · amount owed
              </p>
            </div>
            {editable ? (
              <Button
                variant={editing ? "ghost" : "outline"}
                size="sm"
                onClick={() => setEditing((open) => !open)}
              >
                {editing ? (
                  <>
                    <X /> Cancel
                  </>
                ) : (
                  <>
                    <Pencil /> Edit
                  </>
                )}
              </Button>
            ) : (
              <span
                className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
                title={`A ${statusMeta.label.toLowerCase()} bill is read-only. Only draft and rejected bills can be edited.`}
              >
                <Lock className="size-3.5" />
                Locked
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {editing ? (
          <HeaderForm bill={bill} onDone={() => setEditing(false)} />
        ) : (
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Issue date" value={formatDate(bill.issueDate)} />
            <Field
              label="Due date"
              value={formatDate(bill.dueDate)}
              hint={
                showOverdue
                  ? `Overdue by ${overdue} ${overdue === 1 ? "day" : "days"}`
                  : formatDueDistance(bill.dueDate)
              }
              tone={showOverdue ? "danger" : "muted"}
            />
            <Field
              label="Payment terms"
              value={PAYMENT_TERMS_LABELS[bill.paymentTerms]}
            />
            <Field
              label="Entered by"
              value={
                <span className="flex items-center gap-2">
                  <UserAvatar
                    initials={bill.createdBy.initials}
                    color={bill.createdBy.avatarColor}
                    className="size-5 text-[10px]"
                  />
                  {bill.createdBy.name}
                </span>
              }
            />
            {bill.memo ? (
              <div className="sm:col-span-2 lg:col-span-4">
                <dt className="text-muted-foreground text-xs font-medium">
                  Memo
                </dt>
                <dd className="mt-1 text-sm">{bill.memo}</dd>
              </div>
            ) : null}
          </dl>
        )}

        {editable ? (
          <>
            <Separator />
            <ReadinessPanel
              issues={readiness.issues}
              isDraft={bill.status === "DRAFT"}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

function ReadinessBadge({ state }: { state: "MISSING_INFO" | "READY" }) {
  const meta = DRAFT_READINESS_META[state];
  return (
    <Badge
      variant={meta.badgeVariant}
      className={meta.badgeClassName}
      title={meta.description}
    >
      {state === "READY" ? (
        <CheckCircle2 className="size-3" />
      ) : (
        <AlertTriangle className="size-3" />
      )}
      {meta.label}
    </Badge>
  );
}

/**
 * The *what*, not just the *that*. A blocked draft is only actionable if the
 * reviewer can see which field is missing.
 */
function ReadinessPanel({
  issues,
  isDraft,
}: {
  issues: string[];
  isDraft: boolean;
}) {
  if (issues.length === 0) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-emerald-300/70 bg-emerald-50/70 px-3 py-2.5 text-sm dark:border-emerald-800/60 dark:bg-emerald-950/40">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-emerald-900 dark:text-emerald-200">
          <span className="font-medium">Ready.</span> Every required field is
          present and the line items reconcile to the bill total
          {isDraft ? " — this draft can be submitted for approval." : "."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-orange-300/70 bg-orange-50/70 px-3 py-2.5 text-sm dark:border-orange-800/60 dark:bg-orange-950/40">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-400" />
      <div className="min-w-0">
        <p className="font-medium text-orange-900 dark:text-orange-200">
          Missing info — {issues.length}{" "}
          {issues.length === 1 ? "thing" : "things"} to fix before this bill can
          be submitted
        </p>
        <ul className="mt-1 space-y-0.5 text-orange-900/90 dark:text-orange-200/90">
          {issues.map((issue) => (
            <li key={issue} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "muted" | "danger";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
      {hint ? (
        <p
          className={cn(
            "mt-0.5 text-xs",
            tone === "danger"
              ? "font-medium text-red-600 dark:text-red-400"
              : "text-muted-foreground",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function HeaderForm({
  bill,
  onDone,
}: {
  bill: BillDetail;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [billNumber, setBillNumber] = useState(bill.billNumber);
  const [issueDate, setIssueDate] = useState(toDateInputValue(bill.issueDate));
  const [dueDate, setDueDate] = useState(toDateInputValue(bill.dueDate));
  const [paymentTerms, setPaymentTerms] = useState<string>(bill.paymentTerms);
  const [currency, setCurrency] = useState(bill.currency);
  const [totalAmount, setTotalAmount] = useState(
    formatCents(bill.totalCents, {
      currency: bill.currency,
      showSymbol: false,
    }).replace(/,/g, ""),
  );
  const [memo, setMemo] = useState(bill.memo ?? "");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await updateBillHeader({
        billId: bill.id,
        billNumber,
        issueDate,
        dueDate,
        paymentTerms,
        totalAmount,
        currency,
        memo,
      });

      if (result.ok) {
        toast.success("Bill updated");
        onDone();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="billNumber">Invoice number</Label>
          <Input
            id="billNumber"
            value={billNumber}
            onChange={(event) => setBillNumber(event.target.value)}
            className="font-mono"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="issueDate">Issue date</Label>
          <Input
            id="issueDate"
            type="date"
            value={issueDate}
            onChange={(event) => setIssueDate(event.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dueDate">Due date</Label>
          <Input
            id="dueDate"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="paymentTerms">Payment terms</Label>
          <Select value={paymentTerms} onValueChange={setPaymentTerms}>
            <SelectTrigger id="paymentTerms" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_TERMS.map((term) => (
                <SelectItem key={term} value={term}>
                  {PAYMENT_TERMS_LABELS[term]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="totalAmount">
            Bill total{" "}
            <span className="text-muted-foreground font-normal">
              — authoritative
            </span>
          </Label>
          <Input
            id="totalAmount"
            inputMode="decimal"
            value={totalAmount}
            onChange={(event) => setTotalAmount(event.target.value)}
            className="text-right tabular-nums"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="currency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="memo">Memo</Label>
          <Textarea
            id="memo"
            value={memo}
            rows={2}
            placeholder="Optional note that travels with the bill."
            onChange={(event) => setMemo(event.target.value)}
          />
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        The total is what is owed to the vendor. Line items code the spend
        against it — changing one never changes the other.
      </p>

      {error ? (
        <p className="text-destructive flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDone}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
