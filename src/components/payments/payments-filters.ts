import { PAYMENT_STATUS_META } from "@/lib/bill-status";
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/domain";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-lifecycle";

/**
 * The payments register lives entirely in the URL.
 *
 * Same contract as `@/lib/bill-filters` for the bills inbox, deliberately: the
 * page reads `searchParams`, this module turns them into typed `PaymentFilters`
 * and the query layer turns that into SQL. A filtered register is therefore
 * shareable — paste the URL and a colleague sees the same rows.
 *
 * It sits beside the register's components rather than in `src/lib/` because
 * these are this view's own shaping rules (which sections exist, what a section
 * spans), not domain law. The domain law it depends on — the payment statuses
 * themselves, their labels, the method labels — is imported from the core and
 * never restated. There is no second copy of the payment vocabulary here.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. It only parses, validates and
 * re-serialises strings.
 */

// ---------------------------------------------------------------------------
// Sections — the lifecycle, as a partition
// ---------------------------------------------------------------------------

/**
 * The register's sections follow the Payment lifecycle in order
 * (`SCHEDULED → INITIATED → PAID | FAILED`, ADR 0002), plus an "All" view.
 *
 * Failed is last but never quiet: it is the only outcome where a vendor did not
 * get paid, so the register surfaces it above every section as well.
 */
export const REGISTER_SECTIONS = [
  "scheduled",
  "inflight",
  "completed",
  "failed",
  "all",
] as const;

export type RegisterSection = (typeof REGISTER_SECTIONS)[number];

/** How a section's rows are ordered. Resolved to SQL by the query layer. */
export type RegisterOrder =
  | "SOONEST_FIRST"
  | "LATEST_COMPLETED_FIRST"
  | "LATEST_FIRST";

export interface RegisterSectionMeta {
  label: string;
  /** Payment statuses this section is allowed to show. */
  statuses: readonly PaymentStatus[];
  order: RegisterOrder;
  /** Copy for the empty state when the section has no payments at all. */
  emptyTitle: string;
  emptyDescription: string;
}

export const REGISTER_SECTION_META: Record<
  RegisterSection,
  RegisterSectionMeta
> = {
  scheduled: {
    label: "Scheduled",
    statuses: ["SCHEDULED"],
    order: "SOONEST_FIRST",
    emptyTitle: "Nothing scheduled",
    emptyDescription:
      "Money committed to a date but not yet sent shows up here, soonest first. Schedule a payment from an approved bill to fill it.",
  },
  inflight: {
    label: "In flight",
    statuses: ["INITIATED"],
    order: "SOONEST_FIRST",
    emptyTitle: "Nothing in flight",
    emptyDescription:
      "A payment sits here from the moment it is sent to the bank until the funds land with the vendor.",
  },
  completed: {
    label: "Completed",
    statuses: ["PAID"],
    order: "LATEST_COMPLETED_FIRST",
    emptyTitle: "No completed payments",
    emptyDescription:
      "Payments that settled are kept here with the date the money reached the vendor.",
  },
  failed: {
    label: "Failed",
    statuses: ["FAILED"],
    order: "LATEST_FIRST",
    emptyTitle: "No failed payments — good news",
    emptyDescription:
      "A failed payment means a vendor was not paid and somebody has to act. An empty section means every payment has gone through.",
  },
  all: {
    label: "All",
    statuses: PAYMENT_STATUSES,
    order: "LATEST_FIRST",
    emptyTitle: "No payments yet",
    emptyDescription:
      "Schedule a payment from an approved bill and it will appear in this register.",
  },
};

/**
 * Scheduled is the default because it answers the register's question — what is
 * leaving the bank, and when. Everything else is either already gone or already
 * settled.
 */
export const DEFAULT_REGISTER_SECTION: RegisterSection = "scheduled";

export function statusesForSection(
  section: RegisterSection,
): readonly PaymentStatus[] {
  return REGISTER_SECTION_META[section].statuses;
}

/** True when the section spans more than one status, so narrowing is useful. */
export function sectionSupportsStatusFilter(section: RegisterSection): boolean {
  return statusesForSection(section).length > 1;
}

/** The section whose rows should be grouped by send date. */
export function sectionGroupsByDate(section: RegisterSection): boolean {
  return section === "scheduled";
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface PaymentFilters {
  section: RegisterSection;
  /** Explicit status narrowing WITHIN the section. Empty means "every status". */
  statuses: PaymentStatus[];
  methods: PaymentMethod[];
  vendorIds: string[];
  /**
   * Inclusive send-date bounds as `yyyy-MM-dd`.
   *
   * The range is always read against `scheduledDate` — the date the payment was
   * committed to, which every payment has whatever its status. Filtering
   * completed rows by their settlement date instead would mean the same URL
   * meant two different things in two sections.
   */
  from: string | null;
  to: string | null;
}

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

const SEARCH_PARAM_KEYS = {
  section: "section",
  status: "status",
  method: "method",
  vendor: "vendor",
  from: "from",
  to: "to",
} as const;

function firstValue(
  params: SearchParamsRecord,
  key: string,
): string | undefined {
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * A repeatable param, accepted both as `?method=ACH&method=WIRE` and
 * `?method=ACH,WIRE`, so hand-written URLs work as well as the ones the filter
 * bar builds.
 */
function listValues(params: SearchParamsRecord, key: string): string[] {
  const raw = params[key];
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const flattened = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
  return Array.from(new Set(flattened));
}

function isDateInputValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Parse the URL into typed, already-validated filters. Never throws. */
export function parsePaymentFilters(
  params: SearchParamsRecord = {},
): PaymentFilters {
  const sectionParam = firstValue(params, SEARCH_PARAM_KEYS.section);
  const section = (REGISTER_SECTIONS as readonly string[]).includes(
    sectionParam ?? "",
  )
    ? (sectionParam as RegisterSection)
    : DEFAULT_REGISTER_SECTION;

  const allowedStatuses = statusesForSection(section);
  const statuses = listValues(params, SEARCH_PARAM_KEYS.status).filter(
    (value): value is PaymentStatus =>
      (allowedStatuses as readonly string[]).includes(value),
  );

  const methods = listValues(params, SEARCH_PARAM_KEYS.method).filter(
    (value): value is PaymentMethod =>
      (PAYMENT_METHODS as readonly string[]).includes(value),
  );

  const from = firstValue(params, SEARCH_PARAM_KEYS.from);
  const to = firstValue(params, SEARCH_PARAM_KEYS.to);

  return {
    section,
    statuses,
    methods,
    vendorIds: listValues(params, SEARCH_PARAM_KEYS.vendor),
    from: from && isDateInputValue(from) ? from : null,
    to: to && isDateInputValue(to) ? to : null,
  };
}

/** The statuses the query should actually match. */
export function effectivePaymentStatuses(
  filters: PaymentFilters,
): readonly PaymentStatus[] {
  return filters.statuses.length > 0
    ? filters.statuses
    : statusesForSection(filters.section);
}

// ---------------------------------------------------------------------------
// Serialising back to a URL
// ---------------------------------------------------------------------------

export type PaymentFiltersPatch = Partial<PaymentFilters>;

/**
 * Merge a patch and drop anything that equals the default, so the URL stays
 * short and two paths to the same view produce the same string.
 */
export function buildPaymentsSearchParams(
  filters: PaymentFilters,
  patch: PaymentFiltersPatch = {},
): URLSearchParams {
  const merged: PaymentFilters = { ...filters, ...patch };

  // Switching section invalidates any status narrowing scoped to the old one.
  if (patch.section !== undefined && patch.section !== filters.section) {
    const allowed = statusesForSection(merged.section);
    merged.statuses = merged.statuses.filter((status) =>
      allowed.includes(status),
    );
  }

  const params = new URLSearchParams();

  if (merged.section !== DEFAULT_REGISTER_SECTION) {
    params.set(SEARCH_PARAM_KEYS.section, merged.section);
  }
  for (const status of merged.statuses) {
    params.append(SEARCH_PARAM_KEYS.status, status);
  }
  for (const method of merged.methods) {
    params.append(SEARCH_PARAM_KEYS.method, method);
  }
  for (const vendorId of merged.vendorIds) {
    params.append(SEARCH_PARAM_KEYS.vendor, vendorId);
  }
  if (merged.from) params.set(SEARCH_PARAM_KEYS.from, merged.from);
  if (merged.to) params.set(SEARCH_PARAM_KEYS.to, merged.to);

  return params;
}

export function buildPaymentsHref(
  filters: PaymentFilters,
  patch: PaymentFiltersPatch = {},
  pathname = "/payments",
): string {
  const query = buildPaymentsSearchParams(filters, patch).toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

// ---------------------------------------------------------------------------
// Describing the active filters
// ---------------------------------------------------------------------------

/** Everything except the section — i.e. the removable chips. */
export function activePaymentFilterCount(filters: PaymentFilters): number {
  return (
    filters.statuses.length +
    filters.methods.length +
    filters.vendorIds.length +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0)
  );
}

export function hasActivePaymentFilters(filters: PaymentFilters): boolean {
  return activePaymentFilterCount(filters) > 0;
}

/** Reset every filter while keeping the section the user is looking at. */
export const CLEARED_PAYMENT_FILTERS: PaymentFiltersPatch = {
  statuses: [],
  methods: [],
  vendorIds: [],
  from: null,
  to: null,
};

export interface PaymentFilterChip {
  /** Stable key for React. */
  id: string;
  /** e.g. "Vendor" */
  group: string;
  /** e.g. "Acme Corp" */
  value: string;
  /** The patch that removes just this chip. */
  removePatch: PaymentFiltersPatch;
}

export interface PaymentFilterChipContext {
  vendorNameById?: Record<string, string>;
  /** Injected so this module stays free of rendering concerns. */
  formatDate?: (isoDate: string) => string;
}

/**
 * Turn the active filters into removable chips. Rendering-agnostic on purpose:
 * the caller supplies the formatters, this module supplies the semantics.
 */
export function activePaymentFilterChips(
  filters: PaymentFilters,
  context: PaymentFilterChipContext = {},
): PaymentFilterChip[] {
  const vendorName = (id: string) => context.vendorNameById?.[id] ?? id;
  const date = context.formatDate ?? ((value: string) => value);

  const chips: PaymentFilterChip[] = [];

  for (const status of filters.statuses) {
    chips.push({
      id: `status:${status}`,
      group: "Status",
      value: PAYMENT_STATUS_META[status].label,
      removePatch: {
        statuses: filters.statuses.filter((value) => value !== status),
      },
    });
  }

  for (const method of filters.methods) {
    chips.push({
      id: `method:${method}`,
      group: "Method",
      value: PAYMENT_METHOD_LABELS[method],
      removePatch: {
        methods: filters.methods.filter((value) => value !== method),
      },
    });
  }

  for (const vendorId of filters.vendorIds) {
    chips.push({
      id: `vendor:${vendorId}`,
      group: "Vendor",
      value: vendorName(vendorId),
      removePatch: {
        vendorIds: filters.vendorIds.filter((value) => value !== vendorId),
      },
    });
  }

  if (filters.from) {
    chips.push({
      id: "from",
      group: "Sending on or after",
      value: date(filters.from),
      removePatch: { from: null },
    });
  }

  if (filters.to) {
    chips.push({
      id: "to",
      group: "Sending on or before",
      value: date(filters.to),
      removePatch: { to: null },
    });
  }

  return chips;
}
