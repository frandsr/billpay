"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  Building2,
  Check,
  ChevronsUpDown,
  CircleAlert,
  Info,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  PAYMENT_TERMS_LABELS,
  dueDateFrom,
  fromDateInputValue,
  toDateInputValue,
} from "@/lib/dates";
import { PAYMENT_TERMS, type PaymentTerms } from "@/lib/domain";
import {
  formatCents,
  lineAmountCents,
  parseAmountToCents,
  sumCents,
} from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  createBillAction,
  type CreateBillFormState,
} from "@/server/actions/bills";
import type {
  GlAccountOption,
  NewBillVendorOption,
} from "@/server/queries/bills";

/**
 * Manual bill entry.
 *
 * Two rules shape this form.
 *
 * 1. Money never becomes a float. People type "1,250.00"; every one of those
 *    strings goes through `parseAmountToCents` and every figure shown comes
 *    back through `formatCents`. The line amount is `lineAmountCents(qty, unit)`
 *    — the same helper the server action uses, so the preview and the saved row
 *    round identically.
 * 2. ADR 0004: `Bill.totalCents` is authoritative. The reconciliation strip
 *    shows Σ(line items) against the total and names the difference out loud,
 *    but it never blocks the save and it never rewrites the total from the
 *    lines. A bill that does not reconcile is simply a draft flagged
 *    `Missing info`, which is exactly what stops it being submitted later.
 */

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "MXN"] as const;

const INITIAL_STATE: CreateBillFormState = { status: "idle" };

interface DraftLine {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  glAccountId: string;
  department: string;
}

function emptyLine(key: string): DraftLine {
  return {
    key,
    description: "",
    quantity: "1",
    unitPrice: "",
    glAccountId: "",
    department: "",
  };
}

export interface NewBillFormProps {
  vendors: NewBillVendorOption[];
  glAccounts: GlAccountOption[];
  /** `yyyy-MM-dd`, resolved on the server so SSR and hydration agree. */
  defaultIssueDate: string;
}

export function NewBillForm({
  vendors,
  glAccounts,
  defaultIssueDate,
}: NewBillFormProps) {
  const [state, formAction, isPending] = useActionState(
    createBillAction,
    INITIAL_STATE,
  );

  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [issueDate, setIssueDate] = useState(defaultIssueDate);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>("NET_30");
  const [dueDate, setDueDate] = useState("");
  const [dueDateOverridden, setDueDateOverridden] = useState(false);
  const [currency, setCurrency] = useState<string>("USD");
  const [totalAmount, setTotalAmount] = useState("");
  const [memo, setMemo] = useState("");

  const nextLineKey = useRef(1);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine("line-0")]);

  const vendor = vendors.find((option) => option.id === vendorId) ?? null;

  // The due date is DERIVED from the issue date and the terms until the user
  // takes it over; after that the override is left strictly alone.
  useEffect(() => {
    if (dueDateOverridden) return;
    const issued = fromDateInputValue(issueDate);
    if (!issued) return;
    setDueDate(toDateInputValue(dueDateFrom(issued, paymentTerms)));
  }, [issueDate, paymentTerms, dueDateOverridden]);

  const selectVendor = (option: NewBillVendorOption) => {
    setVendorId(option.id);
    // A vendor carries the terms agreed with it; adopting them is the whole
    // point of storing them, and the due date re-derives from there. Both stay
    // editable, and an explicit due-date override is never overwritten.
    setPaymentTerms(option.defaultPaymentTerms);
    if (option.defaultGlAccountId) {
      setLines((current) =>
        current.map((line) =>
          line.glAccountId === ""
            ? { ...line, glAccountId: option.defaultGlAccountId as string }
            : line,
        ),
      );
    }
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const addLine = () => {
    const key = `line-${nextLineKey.current}`;
    nextLineKey.current += 1;
    setLines((current) => [
      ...current,
      {
        ...emptyLine(key),
        glAccountId: vendor?.defaultGlAccountId ?? "",
      },
    ]);
  };

  const removeLine = (key: string) => {
    setLines((current) =>
      current.length === 1
        ? [emptyLine(current[0]!.key)]
        : current.filter((line) => line.key !== key),
    );
  };

  const lineAmounts = useMemo(
    () =>
      lines.map((line) => {
        const quantity = Number.parseInt(line.quantity, 10);
        const unitPriceCents = parseAmountToCents(line.unitPrice, currency);
        if (
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          unitPriceCents === null
        ) {
          return null;
        }
        return lineAmountCents(quantity, unitPriceCents);
      }),
    [lines, currency],
  );

  const lineItemTotalCents = sumCents(lineAmounts);
  const totalCents = parseAmountToCents(totalAmount, currency);
  const hasTotal = totalCents !== null && totalCents > 0;
  const hasLines = lineAmounts.some((amount) => amount !== null && amount !== 0);
  // Σ(lines) − total. Positive means the coding overshoots the amount owed.
  const differenceCents = hasTotal ? lineItemTotalCents - totalCents : 0;
  const reconciles = hasTotal && hasLines && differenceCents === 0;

  const fieldError = (name: string) => state.fieldErrors?.[name];

  return (
    <form action={formAction} className="space-y-5">
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{state.message}</AlertTitle>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Bill details</CardTitle>
          <CardDescription>
            The invoice document backs the bill; these fields are the payable
            record itself.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Vendor"
            htmlFor="vendor-picker"
            error={fieldError("vendorId")}
            className="sm:col-span-2"
          >
            <VendorPicker
              vendors={vendors}
              selected={vendor}
              onSelect={selectVendor}
            />
            <input type="hidden" name="vendorId" value={vendorId} />
          </Field>

          <Field
            label="Invoice number"
            htmlFor="billNumber"
            error={fieldError("billNumber")}
            hint="From the vendor's invoice. Must be unique for this vendor."
          >
            <Input
              id="billNumber"
              name="billNumber"
              value={billNumber}
              onChange={(event) => setBillNumber(event.target.value)}
              placeholder="INV-10482"
              autoComplete="off"
              required
              aria-invalid={fieldError("billNumber") ? true : undefined}
            />
          </Field>

          <Field label="Payment terms" htmlFor="paymentTerms">
            <Select
              value={paymentTerms}
              onValueChange={(value) => setPaymentTerms(value as PaymentTerms)}
            >
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
            <input type="hidden" name="paymentTerms" value={paymentTerms} />
          </Field>

          <Field label="Issue date" htmlFor="issueDate">
            <Input
              id="issueDate"
              name="issueDate"
              type="date"
              value={issueDate}
              onChange={(event) => setIssueDate(event.target.value)}
              required
            />
          </Field>

          <Field
            label="Due date"
            htmlFor="dueDate"
            error={fieldError("dueDate")}
            hint={
              dueDateOverridden ? (
                <button
                  type="button"
                  className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2 transition-colors"
                  onClick={() => setDueDateOverridden(false)}
                >
                  <RotateCcw className="size-3" />
                  Overridden — reset to {PAYMENT_TERMS_LABELS[paymentTerms]}
                </button>
              ) : (
                `Derived from the issue date and ${PAYMENT_TERMS_LABELS[paymentTerms]}.`
              )
            }
          >
            <Input
              id="dueDate"
              name="dueDate"
              type="date"
              value={dueDate}
              onChange={(event) => {
                setDueDateOverridden(true);
                setDueDate(event.target.value);
              }}
              aria-invalid={fieldError("dueDate") ? true : undefined}
            />
          </Field>

          <Field
            label="Bill total"
            htmlFor="totalAmount"
            error={fieldError("totalAmount")}
            hint="The authoritative amount owed. Line items are coding detail."
          >
            <div className="flex gap-2">
              <Input
                id="totalAmount"
                name="totalAmount"
                inputMode="decimal"
                value={totalAmount}
                onChange={(event) => setTotalAmount(event.target.value)}
                placeholder="0.00"
                required
                className="text-right tabular-nums"
                aria-invalid={fieldError("totalAmount") ? true : undefined}
              />
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="w-24" aria-label="Currency">
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
              <input type="hidden" name="currency" value={currency} />
            </div>
          </Field>

          <Field label="Memo" htmlFor="memo" className="sm:col-span-2">
            <Textarea
              id="memo"
              name="memo"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="Anything the approver should know."
              rows={2}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Line items</CardTitle>
          <CardDescription className="space-y-1">
            <p>
              Each line is coded independently to a GL account and a department.
            </p>
            {/* The split editor deliberately lives on the bill, not here — this
                points at it so the one-account-per-line grid below does not read
                as the only option. */}
            <p className="text-xs">
              To split a line item across several GL accounts or departments — or
              to apply a saved allocation template — save the bill and use the
              coding panel on the bill.
            </p>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-separate border-spacing-y-1 text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs">
                  <th className="w-[30%] px-1 pb-1 text-left font-medium">
                    Description
                  </th>
                  <th className="w-16 px-1 pb-1 text-right font-medium">Qty</th>
                  <th className="w-28 px-1 pb-1 text-right font-medium">
                    Unit price
                  </th>
                  <th className="w-28 px-1 pb-1 text-right font-medium">
                    Amount
                  </th>
                  <th className="px-1 pb-1 text-left font-medium">GL account</th>
                  <th className="w-32 px-1 pb-1 text-left font-medium">
                    Department
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.key} className="align-top">
                    <td className="px-1">
                      <Input
                        value={line.description}
                        onChange={(event) =>
                          updateLine(line.key, { description: event.target.value })
                        }
                        name="lineDescription"
                        placeholder="Annual subscription"
                        aria-label={`Line ${index + 1} description`}
                      />
                    </td>
                    <td className="px-1">
                      <Input
                        value={line.quantity}
                        onChange={(event) =>
                          updateLine(line.key, { quantity: event.target.value })
                        }
                        name="lineQuantity"
                        inputMode="numeric"
                        className="text-right tabular-nums"
                        aria-label={`Line ${index + 1} quantity`}
                        aria-invalid={
                          fieldError(`line.${index}.quantity`) ? true : undefined
                        }
                      />
                    </td>
                    <td className="px-1">
                      <Input
                        value={line.unitPrice}
                        onChange={(event) =>
                          updateLine(line.key, { unitPrice: event.target.value })
                        }
                        name="lineUnitPrice"
                        inputMode="decimal"
                        placeholder="0.00"
                        className="text-right tabular-nums"
                        aria-label={`Line ${index + 1} unit price`}
                        aria-invalid={
                          fieldError(`line.${index}.unitPrice`) ? true : undefined
                        }
                      />
                    </td>
                    <td className="text-muted-foreground h-8 px-2 text-right align-middle tabular-nums">
                      <LineAmount
                        amountCents={lineAmounts[index] ?? null}
                        currency={currency}
                      />
                    </td>
                    <td className="px-1">
                      <Select
                        value={line.glAccountId}
                        onValueChange={(value) =>
                          updateLine(line.key, { glAccountId: value })
                        }
                      >
                        <SelectTrigger
                          className="w-full"
                          aria-label={`Line ${index + 1} GL account`}
                        >
                          <SelectValue placeholder="Uncoded" />
                        </SelectTrigger>
                        <SelectContent>
                          {glAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.code} · {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <input
                        type="hidden"
                        name="lineGlAccountId"
                        value={line.glAccountId}
                      />
                    </td>
                    <td className="px-1">
                      <Input
                        value={line.department}
                        onChange={(event) =>
                          updateLine(line.key, { department: event.target.value })
                        }
                        name="lineDepartment"
                        placeholder="Engineering"
                        aria-label={`Line ${index + 1} department`}
                      />
                    </td>
                    <td className="px-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(line.key)}
                        aria-label={`Remove line ${index + 1}`}
                        title="Remove line"
                      >
                        <Trash2 className="text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus data-icon="inline-start" />
            Add line
          </Button>

          <Separator />

          <Reconciliation
            currency={currency}
            lineItemTotalCents={lineItemTotalCents}
            totalCents={totalCents}
            hasTotal={hasTotal}
            hasLines={hasLines}
            differenceCents={differenceCents}
            reconciles={reconciles}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button asChild variant="ghost">
          <Link href="/bills">Cancel</Link>
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save as draft"}
        </Button>
      </div>
    </form>
  );
}

/** A line whose quantity or price is not yet usable shows an em dash, not a 0. */
function LineAmount({
  amountCents,
  currency,
}: {
  amountCents: number | null;
  currency: string;
}) {
  if (amountCents === null) return <>—</>;
  return <>{formatCents(amountCents, { currency })}</>;
}

// ---------------------------------------------------------------------------
// Σ(line items) against the authoritative total — ADR 0004
// ---------------------------------------------------------------------------

function Reconciliation({
  currency,
  lineItemTotalCents,
  totalCents,
  hasTotal,
  hasLines,
  differenceCents,
  reconciles,
}: {
  currency: string;
  lineItemTotalCents: number;
  totalCents: number | null;
  hasTotal: boolean;
  hasLines: boolean;
  differenceCents: number;
  reconciles: boolean;
}) {
  return (
    <div className="space-y-3">
      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Σ line items</dt>
        <dd className="text-right tabular-nums">
          {formatCents(lineItemTotalCents, { currency })}
        </dd>

        <dt className="text-muted-foreground">Bill total</dt>
        <dd className="text-right font-medium tabular-nums">
          {hasTotal && totalCents !== null
            ? formatCents(totalCents, { currency })
            : "—"}
        </dd>

        <dt className="text-muted-foreground border-t pt-1">Difference</dt>
        <dd
          className={cn(
            "border-t pt-1 text-right font-medium tabular-nums",
            hasTotal && differenceCents !== 0
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground",
          )}
        >
          {hasTotal ? formatCents(differenceCents, { currency }) : "—"}
        </dd>
      </dl>

      {reconciles ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <Check className="size-3.5" />
          The line items reconcile to the bill total.
        </p>
      ) : (
        <Alert>
          <Info className="text-amber-600 dark:text-amber-400" />
          <AlertTitle className="flex flex-wrap items-center gap-2">
            {!hasLines
              ? "This bill has no coded line items yet"
              : "The line items do not sum to the bill total"}
            <Badge
              variant="outline"
              className="border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800/60 dark:bg-orange-950/60 dark:text-orange-300"
            >
              Missing info
            </Badge>
          </AlertTitle>
          <AlertDescription>
            The bill total is authoritative and is saved exactly as entered — it
            is never recalculated from the lines. You can still save this bill:
            it lands as a <strong>Draft</strong> flagged{" "}
            <strong>Missing info</strong>, and cannot be submitted for approval
            until the coding reconciles.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Searchable vendor picker
// ---------------------------------------------------------------------------

function VendorPicker({
  vendors,
  selected,
  onSelect,
}: {
  vendors: NewBillVendorOption[];
  selected: NewBillVendorOption | null;
  onSelect: (vendor: NewBillVendorOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return vendors;
    return vendors.filter((vendor) =>
      vendor.name.toLowerCase().includes(needle),
    );
  }, [query, vendors]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="vendor-picker"
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <Building2 data-icon="inline-start" className="text-muted-foreground" />
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected ? selected.name : "Select a vendor"}
            </span>
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <div className="p-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search vendors"
            aria-label="Search vendors"
            className="h-7"
            autoFocus
          />
        </div>
        <Separator />
        <div className="max-h-72 overflow-y-auto p-1">
          {visible.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-center text-xs">
              No vendors match “{query}”.
            </p>
          ) : (
            visible.map((vendor) => (
              <button
                key={vendor.id}
                type="button"
                onClick={() => {
                  onSelect(vendor);
                  setOpen(false);
                  setQuery("");
                }}
                className="hover:bg-accent flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
              >
                <Check
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    selected?.id === vendor.id ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{vendor.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {PAYMENT_TERMS_LABELS[vendor.defaultPaymentTerms]}
                    {vendor.email ? ` · ${vendor.email}` : ""}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
