"use client";

/**
 * Split editor for ONE line item.
 *
 * GLOSSARY: a split distributes a single line across several GL
 * accounts/dimensions, by percentage or fixed amount, and **Σ(splits) equals
 * the line amount**. A line with no splits is coded by its own `glAccountId`;
 * once it has splits, the splits carry the coding.
 *
 * Everything numeric here comes from `@/lib/splits` — the component never
 * rounds, never re-derives a percentage and never invents a cent:
 *
 *  * `distributeByBasisPoints` hands out the line amount by share, largest
 *    remainder first, so a 1/3 split of $100 is 33.34 / 33.33 / 33.33.
 *  * `applyAllocationTemplate` is the one way a saved template becomes money.
 *  * `splitsReconcile` drives the running total.
 *  * `validateSplits` decides whether Save is allowed — the same function the
 *    server action runs before it writes.
 *
 * Percentages are basis points (1% = 100) in state as well as in the database.
 * The only float in this file is the text the user types before it is parsed.
 */

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  Plus,
  Scale,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { GlAccount } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCents, parseAmountToCents } from "@/lib/money";
import {
  BASIS_POINTS_TOTAL,
  basisPointsOf,
  distributeByBasisPoints,
  formatBasisPoints,
  splitsReconcile,
  validateSplits,
  type SplitLike,
} from "@/lib/splits";
import { cn } from "@/lib/utils";
import {
  applyTemplateToLine,
  clearLineItemSplits,
  saveLineItemSplits,
  type AllocationTemplateOption,
} from "@/server/actions/bill-edit";
import type { BillDetailLineItem } from "@/server/bill-detail";

export interface LineItemSplitsProps {
  line: BillDetailLineItem;
  glAccounts: GlAccount[];
  templates: AllocationTemplateOption[];
  /** Dimension values already in use on this bill, offered as suggestions. */
  departments: string[];
  currency: string;
  onClose: () => void;
}

/** How the reviewer is entering the split. Percentages ride the line amount. */
type SplitMode = "PERCENT" | "AMOUNT";

interface SplitRow {
  key: string;
  glAccountId: string;
  department: string;
  /** User-owned text in PERCENT mode, e.g. "33.33". */
  percentText: string;
  /** User-owned text in AMOUNT mode, in major units. */
  amountText: string;
}

let rowSeq = 0;
const nextKey = () => `split-${++rowSeq}`;

export function LineItemSplits({
  line,
  glAccounts,
  templates,
  departments,
  currency,
  onClose,
}: LineItemSplitsProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Re-sync from the server whenever the persisted split set or the line amount
  // changes underneath us (applying a template writes immediately, and editing
  // the line amount redistributes percentage splits).
  const signature = persistedSignature(line);
  const [syncedSignature, setSyncedSignature] = useState(signature);
  const [mode, setMode] = useState<SplitMode>(() => initialMode(line));
  const [rows, setRows] = useState<SplitRow[]>(() => initialRows(line, currency));

  if (signature !== syncedSignature) {
    setSyncedSignature(signature);
    setMode(initialMode(line));
    setRows(initialRows(line, currency));
  }

  // --- derivation ---------------------------------------------------------

  const basisPoints = rows.map((row) => parsePercentToBasisPoints(row.percentText));
  const distributed = distributeByBasisPoints(line.amountCents, basisPoints);

  const draft: SplitLike[] = rows.map((row, index) => ({
    glAccountId: row.glAccountId || null,
    department: row.department.trim() || null,
    amountCents:
      mode === "PERCENT"
        ? (distributed[index] ?? 0)
        : (parseAmountToCents(row.amountText, currency) ?? 0),
    percentBasisPoints: mode === "PERCENT" ? basisPoints[index] : null,
  }));

  const reconciliation = splitsReconcile(line.amountCents, draft);
  const issues = validateSplits(line.amountCents, draft);
  const rowIssues = new Map<number, string[]>();
  for (const issue of issues) {
    if (issue.index === null) continue;
    rowIssues.set(issue.index, [
      ...(rowIssues.get(issue.index) ?? []),
      issue.message,
    ]);
  }
  const lineLevelIssues = issues.filter((issue) => issue.index === null);
  const percentTotal = basisPoints.reduce((total, bp) => total + bp, 0);

  // --- mutation -----------------------------------------------------------

  function updateRow(key: string, patch: Partial<SplitRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        key: nextKey(),
        glAccountId: "",
        department: "",
        percentText: "0",
        amountText: "0.00",
      },
    ]);
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  /** Equal shares, using the same largest-remainder rule the money uses. */
  function distributeEvenly() {
    const shares = distributeByBasisPoints(
      BASIS_POINTS_TOTAL,
      rows.map(() => 1),
    );
    const amounts = distributeByBasisPoints(line.amountCents, shares);
    setRows((current) =>
      current.map((row, index) => ({
        ...row,
        percentText: basisPointsToText(shares[index] ?? 0),
        amountText: centsToText(amounts[index] ?? 0, currency),
      })),
    );
  }

  function switchMode(next: SplitMode) {
    if (next === mode) return;
    // Carry the current numbers across so switching never changes the split.
    setRows((current) =>
      current.map((row, index) => {
        const amountCents = draft[index]?.amountCents ?? 0;
        return {
          ...row,
          amountText: centsToText(amountCents, currency),
          percentText: basisPointsToText(
            basisPointsOf(amountCents, line.amountCents) ?? 0,
          ),
        };
      }),
    );
    setMode(next);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveLineItemSplits(
        line.id,
        draft.map((split) => ({
          glAccountId: split.glAccountId ?? "",
          department: split.department ?? null,
          amountCents: split.amountCents,
          percentBasisPoints: split.percentBasisPoints ?? null,
        })),
      );
      if (result.ok) {
        toast.success(`Split saved across ${draft.length} GL accounts`);
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  function removeSplit() {
    setError(null);
    startTransition(async () => {
      const result = await clearLineItemSplits(line.id);
      if (result.ok) {
        toast.success("Split removed — the line is coded directly again");
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  function applyTemplate(templateId: string) {
    setError(null);
    startTransition(async () => {
      const result = await applyTemplateToLine(line.id, templateId);
      if (result.ok) {
        const template = templates.find((option) => option.id === templateId);
        toast.success(`Applied “${template?.name ?? "template"}”`);
      } else {
        setError(result.error);
      }
    });
  }

  const blocked = issues.length > 0;

  return (
    <div className="bg-muted/30 space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="text-muted-foreground size-4" />
          <p className="text-sm font-medium">
            Split across GL accounts and dimensions
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-background inline-flex rounded-lg p-0.5 ring-1 ring-foreground/10">
            {(["PERCENT", "AMOUNT"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => switchMode(option)}
                className={cn(
                  "rounded-[7px] px-2.5 py-1 text-xs font-medium transition-colors",
                  mode === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "PERCENT" ? "By %" : "By amount"}
              </button>
            ))}
          </div>

          {templates.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={pending}>
                  <Wand2 /> Apply template
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-xs">
                <DropdownMenuLabel>Allocation templates</DropdownMenuLabel>
                {templates.map((template) => (
                  <DropdownMenuItem
                    key={template.id}
                    onSelect={() => applyTemplate(template.id)}
                    className="flex-col items-start gap-0.5"
                  >
                    <span className="font-medium">{template.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {template.rows
                        .map(
                          (row) =>
                            `${formatBasisPoints(row.percentBasisPoints)} ${row.department ?? row.glAccountCode}`,
                        )
                        .join(" · ")}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-2">
        <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_7rem_5.5rem_6.5rem_1.75rem] gap-2 px-1 text-[11px] font-medium">
          <span>GL account</span>
          <span>Department</span>
          <span className="text-right">Percent</span>
          <span className="text-right">Amount</span>
          <span />
        </div>

        {rows.map((row, index) => {
          const problems = rowIssues.get(index) ?? [];
          const amountCents = draft[index]?.amountCents ?? 0;
          const derivedBp = basisPointsOf(amountCents, line.amountCents);

          return (
            <div key={row.key} className="space-y-1">
              <div className="grid grid-cols-[minmax(0,1fr)_7rem_5.5rem_6.5rem_1.75rem] items-center gap-2">
                <Select
                  value={row.glAccountId || undefined}
                  onValueChange={(value) =>
                    updateRow(row.key, { glAccountId: value })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full"
                    aria-invalid={problems.some((problem) =>
                      problem.includes("GL account"),
                    )}
                  >
                    <SelectValue placeholder="Pick a GL account" />
                  </SelectTrigger>
                  <SelectContent>
                    {glAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        <span className="font-mono text-xs">{account.code}</span>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  value={row.department}
                  list="billpay-departments"
                  placeholder="—"
                  className="h-7 text-sm"
                  onChange={(event) =>
                    updateRow(row.key, { department: event.target.value })
                  }
                />

                {mode === "PERCENT" ? (
                  <div className="relative">
                    <Input
                      value={row.percentText}
                      inputMode="decimal"
                      className="h-7 pr-5 text-right text-sm tabular-nums"
                      onChange={(event) =>
                        updateRow(row.key, { percentText: event.target.value })
                      }
                    />
                    <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs">
                      %
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground pr-2 text-right text-sm tabular-nums">
                    {derivedBp === null ? "—" : formatBasisPoints(derivedBp)}
                  </span>
                )}

                {mode === "AMOUNT" ? (
                  <Input
                    value={row.amountText}
                    inputMode="decimal"
                    className="h-7 text-right text-sm tabular-nums"
                    onChange={(event) =>
                      updateRow(row.key, { amountText: event.target.value })
                    }
                  />
                ) : (
                  <span className="pr-2 text-right text-sm font-medium tabular-nums">
                    {formatCents(amountCents, { currency })}
                  </span>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title="Remove this split row"
                  aria-label="Remove this split row"
                  disabled={rows.length <= 1}
                  onClick={() => removeRow(row.key)}
                >
                  <Trash2 />
                </Button>
              </div>

              {problems.length > 0 ? (
                <p className="text-destructive pl-1 text-xs">
                  {problems.join(" ")}
                </p>
              ) : null}
            </div>
          );
        })}

        <datalist id="billpay-departments">
          {departments.map((department) => (
            <option key={department} value={department} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="xs" onClick={addRow}>
          <Plus /> Add split
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={distributeEvenly}
          disabled={rows.length === 0}
        >
          <Scale /> Distribute evenly
        </Button>
      </div>

      {/* Running total — the whole point of the panel. */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-sm",
          reconciliation.balanced
            ? "border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/40"
            : "border-orange-300/70 bg-orange-50/60 dark:border-orange-800/60 dark:bg-orange-950/40",
        )}
      >
        <div className="flex items-center gap-2">
          {reconciliation.balanced ? (
            <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="size-4 text-orange-600 dark:text-orange-400" />
          )}
          <span className="font-medium tabular-nums">
            {formatCents(reconciliation.codedCents, { currency })}
          </span>
          <span className="text-muted-foreground">
            of {formatCents(reconciliation.lineAmountCents, { currency })}{" "}
            allocated
          </span>
        </div>

        <div className="flex items-center gap-3">
          {mode === "PERCENT" ? (
            <span
              className={cn(
                "text-xs tabular-nums",
                percentTotal === BASIS_POINTS_TOTAL
                  ? "text-muted-foreground"
                  : "text-orange-700 dark:text-orange-300",
              )}
            >
              {formatBasisPoints(percentTotal)} of 100%
            </span>
          ) : null}
          {reconciliation.balanced ? (
            <Badge
              variant="outline"
              className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300"
            >
              Balanced
            </Badge>
          ) : (
            <span className="text-xs font-medium text-orange-700 tabular-nums dark:text-orange-300">
              {reconciliation.differenceCents > 0 ? "Under" : "Over"} by{" "}
              {formatCents(Math.abs(reconciliation.differenceCents), {
                currency,
              })}
            </span>
          )}
        </div>
      </div>

      {lineLevelIssues.length > 0 ? (
        <ul className="text-destructive space-y-0.5 text-xs">
          {lineLevelIssues.map((issue) => (
            <li key={issue.code}>{issue.message}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="text-destructive flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={blocked || pending} onClick={save}>
          {pending ? "Saving…" : "Save split"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={pending}
        >
          <X /> Cancel
        </Button>
        {line.splits.length > 0 ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="ml-auto"
            onClick={removeSplit}
            disabled={pending}
          >
            <Trash2 /> Remove split
          </Button>
        ) : null}
      </div>

      {blocked ? (
        <p className="text-muted-foreground text-xs">
          A split can only be saved when it adds up to the line amount exactly.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// State seeding and text ↔ integer conversion
// ---------------------------------------------------------------------------

function persistedSignature(line: BillDetailLineItem): string {
  return [
    line.amountCents,
    ...line.splits.map(
      (split) =>
        `${split.glAccountId}:${split.department ?? ""}:${split.amountCents}:${split.percentBasisPoints ?? ""}`,
    ),
  ].join("|");
}

function initialMode(line: BillDetailLineItem): SplitMode {
  if (line.splits.length === 0) return "PERCENT";
  return line.splits.every((split) => split.percentBasisPoints !== null)
    ? "PERCENT"
    : "AMOUNT";
}

/**
 * Seed the editor. An unsplit line starts as an even two-way split of its own
 * amount — already balanced, so the only thing left to do is pick the second
 * GL account, which is exactly the shape of the task.
 */
function initialRows(line: BillDetailLineItem, currency: string): SplitRow[] {
  if (line.splits.length > 0) {
    return line.splits.map((split) => ({
      key: nextKey(),
      glAccountId: split.glAccountId,
      department: split.department ?? "",
      percentText: basisPointsToText(
        split.percentBasisPoints ??
          basisPointsOf(split.amountCents, line.amountCents) ??
          0,
      ),
      amountText: centsToText(split.amountCents, currency),
    }));
  }

  const halves = distributeByBasisPoints(line.amountCents, [5_000, 5_000]);
  return [
    {
      key: nextKey(),
      glAccountId: line.glAccountId ?? "",
      department: line.department ?? "",
      percentText: "50",
      amountText: centsToText(halves[0] ?? 0, currency),
    },
    {
      key: nextKey(),
      glAccountId: "",
      department: "",
      percentText: "50",
      amountText: centsToText(halves[1] ?? 0, currency),
    },
  ];
}

/** "33.33" / "33.33%" → 3333 basis points. Never a float in state. */
function parsePercentToBasisPoints(text: string): number {
  const cleaned = text.replace(/[^\d.-]/g, "");
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/** 3333 → "33.33", 5000 → "50". */
function basisPointsToText(basisPoints: number): string {
  return (basisPoints / 100)
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

/** Integer cents → the plain text the amount input holds ("1234.56"). */
function centsToText(cents: number, currency: string): string {
  return formatCents(cents, { currency, showSymbol: false }).replace(/,/g, "");
}
