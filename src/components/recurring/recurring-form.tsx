"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  useMemo,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  LINE_TYPES,
  LINE_TYPE_LABELS,
  SUPPORTED_CURRENCIES,
  type FieldErrors,
  type RecurringBillInput,
  type RecurringLineInput,
  type RecurringLineType,
} from "@/components/recurring/types";
import { UpcomingRuns } from "@/components/recurring/upcoming-runs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PAYMENT_TERMS_LABELS,
  fromDateInputValue,
  toDateInputValue,
  todayUtc,
} from "@/lib/dates";
import {
  PAYMENT_TERMS,
  RECURRING_FREQUENCIES,
  type PaymentTerms,
  type RecurringFrequency,
} from "@/lib/domain";
import { formatCents, lineAmountCents, parseAmountToCents, sumCents } from "@/lib/money";
import { RECURRING_FREQUENCY_LABELS } from "@/lib/recurring";
import {
  createRecurringBill,
  updateRecurringBill,
} from "@/server/actions/recurring";
import { cn } from "@/lib/utils";

/**
 * Create / edit a recurring template.
 *
 * Amounts and quantities stay as the strings the user typed all the way to the
 * server action, which is the only place they become integer cents. The totals
 * shown here are a preview computed with the same `src/lib/money` helpers the
 * server uses — convenience, never authority.
 */

export interface VendorOption {
  id: string;
  name: string;
  defaultPaymentTerms: PaymentTerms;
  defaultGlAccountId: string | null;
}

export interface GlAccountOption {
  id: string;
  code: string;
  name: string;
}

export interface RecurringFormProps {
  vendors: VendorOption[];
  glAccounts: GlAccountOption[];
  /** Present = edit an existing template, absent = create a new one. */
  templateId?: string;
  initial?: RecurringBillInput;
}

/** `<SelectItem>` cannot hold an empty value, so "no GL account" needs a token. */
const NO_GL_ACCOUNT = "__none";

let lineKeySeed = 0;
function nextLineKey(): string {
  lineKeySeed += 1;
  return `line-${lineKeySeed}`;
}

type EditableLine = RecurringLineInput & { key: string };

function emptyLine(glAccountId: string | null = null): EditableLine {
  return {
    key: nextLineKey(),
    description: "",
    quantity: "1",
    unitPrice: "",
    glAccountId,
    department: null,
    lineType: "EXPENSE",
  };
}

function blankTemplate(): RecurringBillInput {
  return {
    vendorId: "",
    name: "",
    amount: "",
    currency: "USD",
    paymentTerms: "NET_30",
    memo: "",
    frequency: "MONTHLY",
    nextRunDate: toDateInputValue(todayUtc()),
    dayOfMonth: "",
    active: true,
    lineItems: [],
  };
}

export function RecurringForm({
  vendors,
  glAccounts,
  templateId,
  initial,
}: RecurringFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [form, setForm] = useState<Omit<RecurringBillInput, "lineItems">>(() => {
    const base = initial ?? blankTemplate();
    const { lineItems: _lineItems, ...rest } = base;
    return rest;
  });

  const [lines, setLines] = useState<EditableLine[]>(() =>
    (initial?.lineItems ?? [emptyLine()]).map((line) => ({
      ...line,
      key: nextLineKey(),
    })),
  );

  const isEdit = Boolean(templateId);

  function patch(changes: Partial<Omit<RecurringBillInput, "lineItems">>) {
    setForm((current) => ({ ...current, ...changes }));
  }

  function patchLine(index: number, changes: Partial<RecurringLineInput>) {
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, ...changes } : line,
      ),
    );
  }

  const selectedVendor = vendors.find((vendor) => vendor.id === form.vendorId);

  /**
   * Preview of Σ(lines) against the authoritative template amount. Mirrors the
   * reconciliation a DRAFT bill goes through: the amount owed is authoritative
   * and the lines are coding detail, so a mismatch is a warning the user has to
   * resolve, not something the form silently rewrites.
   */
  const lineTotalCents = useMemo(
    () =>
      sumCents(
        lines.map((line) => {
          const quantity = Number.parseInt(line.quantity, 10);
          const unitPriceCents = parseAmountToCents(
            line.unitPrice,
            form.currency,
          );
          if (!Number.isFinite(quantity) || unitPriceCents === null) return 0;
          return lineAmountCents(quantity, unitPriceCents);
        }),
      ),
    [lines, form.currency],
  );

  const amountCents = parseAmountToCents(form.amount, form.currency) ?? 0;
  const differenceCents = lineTotalCents - amountCents;
  const uncodedLines = lines.filter((line) => !line.glAccountId).length;

  const previewDate = fromDateInputValue(form.nextRunDate);
  const dayOfMonthValue = form.dayOfMonth.trim()
    ? Number.parseInt(form.dayOfMonth, 10)
    : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload: RecurringBillInput = {
      ...form,
      lineItems: lines.map(({ key: _key, ...line }) => line),
    };

    startTransition(async () => {
      const result = templateId
        ? await updateRecurringBill(templateId, payload)
        : await createRecurringBill(payload);

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }

      setFieldErrors({});
      toast.success(isEdit ? "Template updated" : "Template created", {
        description: form.active
          ? "It will owe a coded draft on its next run date."
          : "Saved as paused — it owes nothing until it is resumed.",
      });
      router.push(`/recurring/${result.data.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card className="gap-4 p-4">
        <h2 className="text-sm font-semibold">Template</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vendor" htmlFor="vendorId" error={fieldErrors.vendorId}>
            <Select
              value={form.vendorId || undefined}
              onValueChange={(value) => {
                const vendor = vendors.find((option) => option.id === value);
                // Pulling the vendor's agreed terms forward is the point of
                // storing a default on the vendor — the user can still override.
                patch({
                  vendorId: value,
                  paymentTerms:
                    vendor?.defaultPaymentTerms ?? form.paymentTerms,
                });
              }}
            >
              <SelectTrigger id="vendorId" className="w-full">
                <SelectValue placeholder="Choose a vendor" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Name" htmlFor="name" error={fieldErrors.name}>
            <Input
              id="name"
              value={form.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder="WeWork — monthly membership"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Amount per bill"
            htmlFor="amount"
            error={fieldErrors.amount}
            hint="The authoritative amount of each generated bill."
          >
            <Input
              id="amount"
              inputMode="decimal"
              value={form.amount}
              onChange={(event) => patch({ amount: event.target.value })}
              placeholder="18,500.00"
            />
          </Field>

          <Field label="Currency" htmlFor="currency" error={fieldErrors.currency}>
            <Select
              value={form.currency}
              onValueChange={(value) => patch({ currency: value })}
            >
              <SelectTrigger id="currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Payment terms"
            htmlFor="paymentTerms"
            error={fieldErrors.paymentTerms}
            hint="Sets the due date of each generated bill."
          >
            <Select
              value={form.paymentTerms}
              onValueChange={(value) =>
                patch({ paymentTerms: value as PaymentTerms })
              }
            >
              <SelectTrigger id="paymentTerms" className="w-full">
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
          </Field>
        </div>

        <Field label="Memo" htmlFor="memo" error={fieldErrors.memo}>
          <Textarea
            id="memo"
            rows={2}
            value={form.memo}
            onChange={(event) => patch({ memo: event.target.value })}
            placeholder="Copied onto every generated draft."
          />
        </Field>
      </Card>

      <Card className="gap-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">Schedule</h2>
          <p className="text-muted-foreground text-xs">
            Dates are UTC. A day-of-month past the end of a short month is
            clamped to the last day and then restored — the 31st becomes Feb 28
            and returns to Mar 31, so the series never drifts earlier.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Frequency"
            htmlFor="frequency"
            error={fieldErrors.frequency}
          >
            <Select
              value={form.frequency}
              onValueChange={(value) =>
                patch({ frequency: value as RecurringFrequency })
              }
            >
              <SelectTrigger id="frequency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRING_FREQUENCIES.map((frequency) => (
                  <SelectItem key={frequency} value={frequency}>
                    {RECURRING_FREQUENCY_LABELS[frequency]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label={isEdit ? "Next run date" : "First run date"}
            htmlFor="nextRunDate"
            error={fieldErrors.nextRunDate}
            hint="A date in the past means the template is due immediately."
          >
            <Input
              id="nextRunDate"
              type="date"
              value={form.nextRunDate}
              onChange={(event) => patch({ nextRunDate: event.target.value })}
            />
          </Field>

          <Field
            label="Day of month"
            htmlFor="dayOfMonth"
            error={fieldErrors.dayOfMonth}
            hint="Optional — defaults to the day of the run date."
          >
            <Input
              id="dayOfMonth"
              type="number"
              min={1}
              max={31}
              value={form.dayOfMonth}
              onChange={(event) => patch({ dayOfMonth: event.target.value })}
              placeholder="1"
            />
          </Field>
        </div>

        {previewDate ? (
          <UpcomingRuns
            schedule={{
              frequency: form.frequency,
              nextRunDate: previewDate,
              dayOfMonth: dayOfMonthValue,
              active: form.active,
            }}
            count={4}
            long
          />
        ) : null}

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.active}
            onCheckedChange={(checked) => patch({ active: checked === true })}
          />
          <span>Active</span>
          <span className="text-muted-foreground text-xs">
            A paused template owes nothing until it is resumed.
          </span>
        </label>
      </Card>

      <Card className="gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Line items and GL coding</h2>
            <p className="text-muted-foreground text-xs">
              Copied onto every generated draft, coding included — this is what
              turns a recurring bill into review instead of data entry.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setLines((current) => [
                ...current,
                emptyLine(selectedVendor?.defaultGlAccountId ?? null),
              ])
            }
          >
            <Plus data-icon="inline-start" />
            Add line
          </Button>
        </div>

        {fieldErrors.lineItems ? (
          <p className="text-destructive text-xs">{fieldErrors.lineItems}</p>
        ) : null}

        <div className="space-y-3">
          {lines.map((line, index) => {
            const quantity = Number.parseInt(line.quantity, 10);
            const unitPriceCents = parseAmountToCents(
              line.unitPrice,
              form.currency,
            );
            const amount =
              Number.isFinite(quantity) && unitPriceCents !== null
                ? lineAmountCents(quantity, unitPriceCents)
                : 0;

            return (
              <div
                key={line.key}
                className="grid gap-3 rounded-lg border p-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-5">
                  <Field
                    label="Description"
                    htmlFor={`line-${index}-description`}
                    error={fieldErrors[`lineItems.${index}.description`]}
                  >
                    <Input
                      id={`line-${index}-description`}
                      value={line.description}
                      onChange={(event) =>
                        patchLine(index, { description: event.target.value })
                      }
                      placeholder="Dedicated desks — 42 @ monthly rate"
                    />
                  </Field>
                </div>

                <div className="sm:col-span-2">
                  <Field
                    label="Qty"
                    htmlFor={`line-${index}-quantity`}
                    error={fieldErrors[`lineItems.${index}.quantity`]}
                  >
                    <Input
                      id={`line-${index}-quantity`}
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(event) =>
                        patchLine(index, { quantity: event.target.value })
                      }
                    />
                  </Field>
                </div>

                <div className="sm:col-span-3">
                  <Field
                    label="Unit price"
                    htmlFor={`line-${index}-unitPrice`}
                    error={fieldErrors[`lineItems.${index}.unitPrice`]}
                  >
                    <Input
                      id={`line-${index}-unitPrice`}
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(event) =>
                        patchLine(index, { unitPrice: event.target.value })
                      }
                      placeholder="410.00"
                    />
                  </Field>
                </div>

                <div className="flex items-end justify-between gap-2 sm:col-span-2">
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-[11px] font-medium">
                      Amount
                    </span>
                    <p className="text-sm font-medium tabular-nums">
                      {formatCents(amount, { currency: form.currency })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove line ${index + 1}`}
                    onClick={() =>
                      setLines((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>

                <div className="sm:col-span-5">
                  <Field
                    label="GL account"
                    htmlFor={`line-${index}-gl`}
                    error={fieldErrors[`lineItems.${index}.glAccountId`]}
                  >
                    <Select
                      value={line.glAccountId ?? NO_GL_ACCOUNT}
                      onValueChange={(value) =>
                        patchLine(index, {
                          glAccountId: value === NO_GL_ACCOUNT ? null : value,
                        })
                      }
                    >
                      <SelectTrigger id={`line-${index}-gl`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_GL_ACCOUNT}>
                          No GL account
                        </SelectItem>
                        {glAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.code} — {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="sm:col-span-4">
                  <Field
                    label="Department"
                    htmlFor={`line-${index}-department`}
                    error={fieldErrors[`lineItems.${index}.department`]}
                  >
                    <Input
                      id={`line-${index}-department`}
                      value={line.department ?? ""}
                      onChange={(event) =>
                        patchLine(index, {
                          department: event.target.value || null,
                        })
                      }
                      placeholder="Operations"
                    />
                  </Field>
                </div>

                <div className="sm:col-span-3">
                  <Field label="Line type" htmlFor={`line-${index}-type`}>
                    <Select
                      value={line.lineType}
                      onValueChange={(value) =>
                        patchLine(index, {
                          lineType: value as RecurringLineType,
                        })
                      }
                    >
                      <SelectTrigger
                        id={`line-${index}-type`}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LINE_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {LINE_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>
            );
          })}
        </div>

        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
            differenceCents !== 0 &&
              "border-orange-300 bg-orange-50 dark:border-orange-800/60 dark:bg-orange-950/40",
          )}
        >
          <span className="flex items-center gap-2">
            {differenceCents !== 0 ? (
              <TriangleAlert className="size-3.5 text-orange-700 dark:text-orange-400" />
            ) : null}
            <span>
              Lines total{" "}
              <strong className="tabular-nums">
                {formatCents(lineTotalCents, { currency: form.currency })}
              </strong>{" "}
              vs bill amount{" "}
              <strong className="tabular-nums">
                {formatCents(amountCents, { currency: form.currency })}
              </strong>
              {differenceCents !== 0 ? (
                <>
                  {" "}
                  — off by{" "}
                  <strong className="tabular-nums">
                    {formatCents(differenceCents, { currency: form.currency })}
                  </strong>
                  . Generated drafts will be flagged <em>Missing info</em>.
                </>
              ) : null}
            </span>
          </span>
          {differenceCents !== 0 ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() =>
                patch({
                  amount: formatCents(lineTotalCents, {
                    currency: form.currency,
                    showSymbol: false,
                  }),
                })
              }
            >
              Match lines
            </Button>
          ) : null}
        </div>

        {uncodedLines > 0 ? (
          <p className="text-muted-foreground text-xs">
            {uncodedLines} {uncodedLines === 1 ? "line has" : "lines have"} no GL
            account. The generated draft will be flagged <em>Missing info</em>{" "}
            until it is coded.
          </p>
        ) : null}
      </Card>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending
            ? "Saving…"
            : isEdit
              ? "Save template"
              : "Create template"}
        </Button>
        <Button type="button" variant="ghost" asChild>
          <Link href={templateId ? `/recurring/${templateId}` : "/recurring"}>
            Cancel
          </Link>
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
