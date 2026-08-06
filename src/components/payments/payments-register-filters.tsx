"use client";

import * as React from "react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarRange,
  ChevronDown,
  CreditCard,
  Loader2,
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
  CLEARED_PAYMENT_FILTERS,
  buildPaymentsHref,
  hasActivePaymentFilters,
  sectionSupportsStatusFilter,
  statusesForSection,
  type PaymentFilters,
  type PaymentFiltersPatch,
} from "@/components/payments/payments-filters";
import { PAYMENT_STATUS_META } from "@/lib/bill-status";
import { addDays, toDateInputValue, todayUtc } from "@/lib/dates";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/domain";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-lifecycle";
import { cn } from "@/lib/utils";

/**
 * The register's filter bar.
 *
 * The only Client Component on the page, and it holds no list state: every
 * control writes to the URL and the server re-renders the table. Same contract
 * as the bills inbox filter bar, deliberately — one pattern for filtering in
 * this product, not two.
 *
 * Typed by `PaymentFilters` from the pure module, so the parse and the controls
 * cannot disagree about what a param means.
 */

export interface PaymentVendorFilterOption {
  id: string;
  name: string;
}

export interface PaymentsRegisterFiltersProps {
  filters: PaymentFilters;
  vendors: PaymentVendorFilterOption[];
}

export function PaymentsRegisterFilters({
  filters,
  vendors,
}: PaymentsRegisterFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate = (patch: PaymentFiltersPatch) => {
    startTransition(() => {
      router.push(buildPaymentsHref(filters, patch), { scroll: false });
    });
  };

  const dateRangeActive = Boolean(filters.from || filters.to);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <VendorFilter
        vendors={vendors}
        selected={filters.vendorIds}
        onChange={(vendorIds) => navigate({ vendorIds })}
      />

      <MethodFilter
        selected={filters.methods}
        onChange={(methods) => navigate({ methods })}
      />

      {/* Only offered where the section spans more than one status — narrowing
          the Scheduled section to "Scheduled" would be a no-op control. */}
      {sectionSupportsStatusFilter(filters.section) ? (
        <StatusFilter
          statuses={statusesForSection(filters.section)}
          selected={filters.statuses}
          onChange={(statuses) => navigate({ statuses })}
        />
      ) : null}

      <SendDateFilter
        from={filters.from}
        to={filters.to}
        active={dateRangeActive}
        onChange={(patch) => navigate(patch)}
      />

      {hasActivePaymentFilters(filters) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate(CLEARED_PAYMENT_FILTERS)}
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
  vendors: PaymentVendorFilterOption[];
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
// Method — which rail the money takes
// ---------------------------------------------------------------------------

function MethodFilter({
  selected,
  onChange,
}: {
  selected: PaymentMethod[];
  onChange: (methods: PaymentMethod[]) => void;
}) {
  const toggle = (method: PaymentMethod) => {
    onChange(
      selected.includes(method)
        ? selected.filter((value) => value !== method)
        : [...selected, method],
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTrigger
          icon={CreditCard}
          label="Method"
          count={selected.length}
          active={selected.length > 0}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {PAYMENT_METHODS.map((method) => (
          <button
            key={method}
            type="button"
            onClick={() => toggle(method)}
            className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
          >
            <Checkbox
              checked={selected.includes(method)}
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none"
            />
            <span>{PAYMENT_METHOD_LABELS[method]}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Status — narrows within the section
// ---------------------------------------------------------------------------

function StatusFilter({
  statuses,
  selected,
  onChange,
}: {
  statuses: readonly PaymentStatus[];
  selected: PaymentStatus[];
  onChange: (statuses: PaymentStatus[]) => void;
}) {
  const toggle = (status: PaymentStatus) => {
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
            <span>{PAYMENT_STATUS_META[status].label}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Send-date range
// ---------------------------------------------------------------------------

/**
 * The range always reads against the send date, in every section — the date the
 * payment was committed to, which every payment has whatever its status. A
 * range that silently switched to the settlement date on the Completed section
 * would make one URL mean two different things.
 */
function SendDateFilter({
  from,
  to,
  active,
  onChange,
}: {
  from: string | null;
  to: string | null;
  active: boolean;
  onChange: (patch: PaymentFiltersPatch) => void;
}) {
  const presets = () => {
    const today = todayUtc();
    return [
      {
        label: "This week",
        patch: {
          from: toDateInputValue(today),
          to: toDateInputValue(addDays(today, 6)),
        } satisfies PaymentFiltersPatch,
      },
      {
        label: "Next 30 days",
        patch: {
          from: toDateInputValue(today),
          to: toDateInputValue(addDays(today, 30)),
        } satisfies PaymentFiltersPatch,
      },
      {
        label: "Last 30 days",
        patch: {
          from: toDateInputValue(addDays(today, -30)),
          to: toDateInputValue(today),
        } satisfies PaymentFiltersPatch,
      },
    ];
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FilterTrigger icon={CalendarRange} label="Send date" active={active} />
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
            <Label htmlFor="send-from" className="text-muted-foreground text-xs">
              From
            </Label>
            <Input
              id="send-from"
              type="date"
              defaultValue={from ?? ""}
              onChange={(event) =>
                onChange({ from: event.target.value || null })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="send-to" className="text-muted-foreground text-xs">
              To
            </Label>
            <Input
              id="send-to"
              type="date"
              defaultValue={to ?? ""}
              onChange={(event) => onChange({ to: event.target.value || null })}
            />
          </div>
        </div>
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ from: null, to: null })}
          >
            Clear send dates
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
