"use client";

import * as React from "react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarRange,
  Check,
  ChevronDown,
  CircleDollarSign,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  CLEARED_FILTERS,
  buildBillsHref,
  centsToInputValue,
  hasActiveFilters,
  statusesForTab,
  tabSupportsStatusFilter,
  type BillFilters,
  type BillFiltersPatch,
} from "@/lib/bill-filters";
import { BILL_STATUS_META, type DraftReadiness } from "@/lib/bill-status";
import { addDays, toDateInputValue, todayUtc } from "@/lib/dates";
import type { BillStatus } from "@/lib/domain";
import { parseAmountToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The inbox filter bar.
 *
 * The only Client Component in the inbox, and it holds no list state: every
 * control writes to the URL and the server re-renders the table. That keeps the
 * view shareable, keeps the 45-row query on the server, and means the back
 * button undoes a filter like a user expects it to.
 *
 * Typed by `BillFilters` from the pure module, so the parse and the controls
 * cannot disagree about what a param means.
 */

export interface VendorFilterOption {
  id: string;
  name: string;
}

export interface BillsInboxFiltersProps {
  filters: BillFilters;
  vendors: VendorFilterOption[];
}

const READINESS_OPTIONS: { value: DraftReadiness; label: string }[] = [
  { value: "MISSING_INFO", label: "Missing info" },
  { value: "READY", label: "Ready" },
];

export function BillsInboxFilters({ filters, vendors }: BillsInboxFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate = (patch: BillFiltersPatch) => {
    startTransition(() => {
      router.push(buildBillsHref(filters, patch), { scroll: false });
    });
  };

  const showStatusFilter = tabSupportsStatusFilter(filters.tab);
  const showReadinessFilter = statusesForTab(filters.tab).includes("DRAFT");
  const dateRangeActive = Boolean(filters.dueFrom || filters.dueTo);
  const amountRangeActive =
    filters.minAmountCents !== null || filters.maxAmountCents !== null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchField
        value={filters.search ?? ""}
        onCommit={(search) => navigate({ search: search === "" ? null : search })}
      />

      <VendorFilter
        vendors={vendors}
        selected={filters.vendorIds}
        onChange={(vendorIds) => navigate({ vendorIds })}
      />

      {showStatusFilter ? (
        <StatusFilter
          statuses={statusesForTab(filters.tab)}
          selected={filters.statuses}
          onChange={(statuses) => navigate({ statuses })}
        />
      ) : null}

      {showReadinessFilter ? (
        <ReadinessFilter
          value={filters.readiness}
          onChange={(readiness) => navigate({ readiness })}
        />
      ) : null}

      <DueDateFilter
        from={filters.dueFrom}
        to={filters.dueTo}
        active={dateRangeActive}
        onChange={(patch) => navigate(patch)}
      />

      <AmountFilter
        minCents={filters.minAmountCents}
        maxCents={filters.maxAmountCents}
        active={amountRangeActive}
        onChange={(patch) => navigate(patch)}
      />

      {hasActiveFilters(filters) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate(CLEARED_FILTERS)}
        >
          <X data-icon="inline-start" />
          Clear filters
        </Button>
      ) : null}

      {isPending ? (
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          Updating
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function SearchField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Re-sync when the URL changes underneath us (back button, cleared filters).
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => onCommit(draft.trim()), 350);
    return () => clearTimeout(timer);
    // `onCommit` is recreated each render; the draft and the committed value are
    // what actually decide whether to navigate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value]);

  return (
    <div className="relative w-full sm:w-64">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <Input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search vendor, bill number, memo"
        aria-label="Search bills"
        className="pl-8"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared popover trigger
// ---------------------------------------------------------------------------

interface FilterTriggerProps extends React.ComponentProps<typeof Button> {
  icon: typeof Building2;
  label: string;
  count?: number;
  active?: boolean;
}

/**
 * Spreads the props it is given onto the `<Button>` so `<PopoverTrigger asChild>`
 * can hand it the trigger behaviour instead of wrapping it in a click-eating
 * `<span>`.
 */
function FilterTrigger({
  icon: Icon,
  label,
  count,
  active,
  className,
  ...props
}: FilterTriggerProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(active && "border-foreground/30 bg-muted/60", className)}
      {...props}
    >
      <Icon data-icon="inline-start" />
      {label}
      {count ? (
        <Badge variant="secondary" className="ml-0.5 px-1.5 tabular-nums">
          {count}
        </Badge>
      ) : null}
      <ChevronDown className="text-muted-foreground" />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Vendor — searchable multi-select
// ---------------------------------------------------------------------------

function VendorFilter({
  vendors,
  selected,
  onChange,
}: {
  vendors: VendorFilterOption[];
  selected: string[];
  onChange: (vendorIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return vendors;
    return vendors.filter((vendor) =>
      vendor.name.toLowerCase().includes(needle),
    );
  }, [query, vendors]);

  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTrigger
          icon={Building2}
          label="Vendor"
          count={selected.length}
          active={selected.length > 0}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="p-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a vendor"
            aria-label="Find a vendor"
            className="h-7"
          />
        </div>
        <Separator />
        <div className="max-h-64 overflow-y-auto p-1">
          {visible.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-center text-xs">
              No vendors match “{query}”.
            </p>
          ) : (
            visible.map((vendor) => (
              <button
                key={vendor.id}
                type="button"
                onClick={() => toggle(vendor.id)}
                className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
              >
                <Checkbox
                  checked={selected.includes(vendor.id)}
                  tabIndex={-1}
                  aria-hidden
                  className="pointer-events-none"
                />
                <span className="truncate">{vendor.name}</span>
              </button>
            ))
          )}
        </div>
        {selected.length > 0 ? (
          <>
            <Separator />
            <div className="p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => onChange([])}
              >
                Clear vendors
              </Button>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Status — narrows within the tab
// ---------------------------------------------------------------------------

function StatusFilter({
  statuses,
  selected,
  onChange,
}: {
  statuses: readonly BillStatus[];
  selected: BillStatus[];
  onChange: (statuses: BillStatus[]) => void;
}) {
  const toggle = (status: BillStatus) => {
    onChange(
      selected.includes(status)
        ? selected.filter((value) => value !== status)
        : [...selected, status],
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTrigger
          icon={SlidersHorizontal}
          label="Status"
          count={selected.length}
          active={selected.length > 0}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {statuses.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => toggle(status)}
            className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
          >
            <Checkbox
              checked={selected.includes(status)}
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none"
            />
            <span>{BILL_STATUS_META[status].label}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Derived draft flag
// ---------------------------------------------------------------------------

function ReadinessFilter({
  value,
  onChange,
}: {
  value: DraftReadiness | null;
  onChange: (readiness: DraftReadiness | null) => void;
}) {
  return (
    <div className="border-input flex h-8 items-center rounded-lg border p-0.5">
      {READINESS_OPTIONS.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(isActive ? null : option.value)}
            className={cn(
              "rounded-[6px] px-2 py-0.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Due date range
// ---------------------------------------------------------------------------

function DueDateFilter({
  from,
  to,
  active,
  onChange,
}: {
  from: string | null;
  to: string | null;
  active: boolean;
  onChange: (patch: BillFiltersPatch) => void;
}) {
  const presets = () => {
    const today = todayUtc();
    return [
      {
        label: "Past due",
        patch: {
          dueFrom: null,
          dueTo: toDateInputValue(addDays(today, -1)),
        } satisfies BillFiltersPatch,
      },
      {
        label: "Due in 7 days",
        patch: {
          dueFrom: toDateInputValue(today),
          dueTo: toDateInputValue(addDays(today, 7)),
        } satisfies BillFiltersPatch,
      },
      {
        label: "Due in 30 days",
        patch: {
          dueFrom: toDateInputValue(today),
          dueTo: toDateInputValue(addDays(today, 30)),
        } satisfies BillFiltersPatch,
      },
    ];
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTrigger icon={CalendarRange} label="Due date" active={active} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="flex flex-wrap gap-1">
          {presets().map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => onChange(preset.patch)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <Separator />
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="due-from" className="text-muted-foreground text-xs">
              From
            </Label>
            <Input
              id="due-from"
              type="date"
              defaultValue={from ?? ""}
              onChange={(event) =>
                onChange({ dueFrom: event.target.value || null })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="due-to" className="text-muted-foreground text-xs">
              To
            </Label>
            <Input
              id="due-to"
              type="date"
              defaultValue={to ?? ""}
              onChange={(event) => onChange({ dueTo: event.target.value || null })}
            />
          </div>
        </div>
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ dueFrom: null, dueTo: null })}
          >
            Clear due dates
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Amount range — typed in dollars, held as integer cents
// ---------------------------------------------------------------------------

function AmountFilter({
  minCents,
  maxCents,
  active,
  onChange,
}: {
  minCents: number | null;
  maxCents: number | null;
  active: boolean;
  onChange: (patch: BillFiltersPatch) => void;
}) {
  const [min, setMin] = useState(
    minCents === null ? "" : centsToInputValue(minCents),
  );
  const [max, setMax] = useState(
    maxCents === null ? "" : centsToInputValue(maxCents),
  );

  useEffect(() => {
    setMin(minCents === null ? "" : centsToInputValue(minCents));
    setMax(maxCents === null ? "" : centsToInputValue(maxCents));
  }, [minCents, maxCents]);

  const apply = () => {
    onChange({
      // Humans type "1,250" or "$1,250.00"; parseAmountToCents is the one place
      // that turns any of those into integer cents.
      minAmountCents: min.trim() === "" ? null : parseAmountToCents(min),
      maxAmountCents: max.trim() === "" ? null : parseAmountToCents(max),
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTrigger icon={CircleDollarSign} label="Amount" active={active} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="amount-min" className="text-muted-foreground text-xs">
              Minimum
            </Label>
            <Input
              id="amount-min"
              inputMode="decimal"
              value={min}
              placeholder="0.00"
              onChange={(event) => setMin(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") apply();
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="amount-max" className="text-muted-foreground text-xs">
              Maximum
            </Label>
            <Input
              id="amount-max"
              inputMode="decimal"
              value={max}
              placeholder="No limit"
              onChange={(event) => setMax(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") apply();
              }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={apply}>
            <Check data-icon="inline-start" />
            Apply
          </Button>
          {active ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({ minAmountCents: null, maxAmountCents: null })
              }
            >
              Clear
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
