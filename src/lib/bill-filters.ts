import { BILL_STATUS_META, type DraftReadiness } from "@/lib/bill-status";
import { BILL_STATUSES, type BillStatus } from "@/lib/domain";
import { parseAmountToCents } from "@/lib/money";

/**
 * The bills inbox lives entirely in the URL.
 *
 * Every tab, filter, sort and page is a search param, which is what keeps the
 * inbox a Server Component: the page reads `searchParams`, this module turns
 * them into a typed `BillFilters`, and the query layer turns that into SQL. A
 * filtered view is therefore shareable — paste the URL and a colleague sees the
 * same 12 rows.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`. It only parses, validates and
 * re-serialises strings, so it is testable without a database or a DOM.
 */

// ---------------------------------------------------------------------------
// Tabs — the workload partition
// ---------------------------------------------------------------------------

export const INBOX_TABS = [
  "drafts",
  "awaiting",
  "approved",
  "history",
  "all",
] as const;

export type InboxTab = (typeof INBOX_TABS)[number];

export interface InboxTabMeta {
  label: string;
  /** Statuses this tab is allowed to show. */
  statuses: readonly BillStatus[];
  /** Copy for the empty state when the tab has no bills at all. */
  emptyTitle: string;
  emptyDescription: string;
}

/**
 * History deliberately groups PAID, REJECTED and ARCHIVED: they are the three
 * ways a bill leaves the working queue, and none of them needs daily attention.
 */
export const INBOX_TAB_META: Record<InboxTab, InboxTabMeta> = {
  drafts: {
    label: "Drafts",
    statuses: ["DRAFT"],
    emptyTitle: "No drafts",
    emptyDescription:
      "Bills you create or import land here until they are submitted for approval.",
  },
  awaiting: {
    label: "Awaiting approval",
    statuses: ["AWAITING_APPROVAL"],
    emptyTitle: "Nothing awaiting approval",
    emptyDescription: "Submitted bills appear here until every approver has decided.",
  },
  approved: {
    label: "Approved",
    statuses: ["APPROVED"],
    emptyTitle: "No approved bills",
    emptyDescription: "Approved bills are eligible to have a payment scheduled.",
  },
  history: {
    label: "History",
    statuses: ["PAID", "REJECTED", "ARCHIVED"],
    emptyTitle: "No history yet",
    emptyDescription:
      "Paid, rejected and archived bills are kept here — archiving is not deleting.",
  },
  all: {
    label: "All",
    statuses: BILL_STATUSES,
    emptyTitle: "No bills yet",
    emptyDescription: "Create a bill manually or import one to get started.",
  },
};

export const DEFAULT_INBOX_TAB: InboxTab = "drafts";

export function statusesForTab(tab: InboxTab): readonly BillStatus[] {
  return INBOX_TAB_META[tab].statuses;
}

/** True when the tab spans more than one status, so a status filter is useful. */
export function tabSupportsStatusFilter(tab: InboxTab): boolean {
  return statusesForTab(tab).length > 1;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export const BILL_SORT_KEYS = [
  "dueDate",
  "amount",
  "vendor",
  "status",
  "billNumber",
  "createdAt",
] as const;

export type BillSortKey = (typeof BILL_SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

export interface BillSortMeta {
  label: string;
  /** Direction applied the first time a column is clicked. */
  defaultDirection: SortDirection;
}

export const BILL_SORT_META: Record<BillSortKey, BillSortMeta> = {
  dueDate: { label: "Due date", defaultDirection: "asc" },
  amount: { label: "Amount", defaultDirection: "desc" },
  vendor: { label: "Vendor", defaultDirection: "asc" },
  status: { label: "Status", defaultDirection: "asc" },
  billNumber: { label: "Bill number", defaultDirection: "asc" },
  createdAt: { label: "Created", defaultDirection: "desc" },
};

/** Soonest-due first on the working tabs; most recently closed first on History. */
export function defaultSortForTab(tab: InboxTab): {
  sort: BillSortKey;
  direction: SortDirection;
} {
  if (tab === "history") return { sort: "createdAt", direction: "desc" };
  return { sort: "dueDate", direction: "asc" };
}

/**
 * What clicking a column header should do: first click applies that column's
 * natural direction, clicking the active column flips it.
 */
export function nextSort(
  filters: BillFilters,
  key: BillSortKey,
): { sort: BillSortKey; direction: SortDirection } {
  if (filters.sort !== key) {
    return { sort: key, direction: BILL_SORT_META[key].defaultDirection };
  }
  return { sort: key, direction: filters.direction === "asc" ? "desc" : "asc" };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const DRAFT_READINESS_FILTERS = ["MISSING_INFO", "READY"] as const;

export const DEFAULT_PAGE_SIZE = 25;

export interface BillFilters {
  tab: InboxTab;
  /** Explicit status narrowing WITHIN the tab. Empty means "every tab status". */
  statuses: BillStatus[];
  vendorIds: string[];
  /** Free text over bill number, vendor name and memo. */
  search: string | null;
  /** Inclusive due-date bounds as `yyyy-MM-dd`, the shape `<input type="date">` uses. */
  dueFrom: string | null;
  dueTo: string | null;
  /** Inclusive amount bounds in integer minor units. Never floats. */
  minAmountCents: number | null;
  maxAmountCents: number | null;
  /** Derived draft flag. Only meaningful where DRAFT is in scope. */
  readiness: DraftReadiness | null;
  sort: BillSortKey;
  direction: SortDirection;
  /** 1-based. */
  page: number;
  pageSize: number;
}

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

const SEARCH_PARAM_KEYS = {
  tab: "tab",
  status: "status",
  vendor: "vendor",
  search: "q",
  dueFrom: "dueFrom",
  dueTo: "dueTo",
  min: "min",
  max: "max",
  readiness: "flag",
  sort: "sort",
  direction: "dir",
  page: "page",
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
 * A repeatable param, accepted both as `?vendor=a&vendor=b` and `?vendor=a,b`
 * so hand-written URLs work as well as the ones the filter bar builds.
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
export function parseBillFilters(
  params: SearchParamsRecord = {},
): BillFilters {
  const tabParam = firstValue(params, SEARCH_PARAM_KEYS.tab);
  const tab = (INBOX_TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as InboxTab)
    : DEFAULT_INBOX_TAB;

  const allowedStatuses = statusesForTab(tab);
  const statuses = listValues(params, SEARCH_PARAM_KEYS.status).filter(
    (value): value is BillStatus =>
      (allowedStatuses as readonly string[]).includes(value),
  );

  const sortParam = firstValue(params, SEARCH_PARAM_KEYS.sort);
  const fallbackSort = defaultSortForTab(tab);
  const sort = (BILL_SORT_KEYS as readonly string[]).includes(sortParam ?? "")
    ? (sortParam as BillSortKey)
    : fallbackSort.sort;

  const directionParam = firstValue(params, SEARCH_PARAM_KEYS.direction);
  const direction: SortDirection =
    directionParam === "asc" || directionParam === "desc"
      ? directionParam
      : sortParam === sort
        ? BILL_SORT_META[sort].defaultDirection
        : fallbackSort.direction;

  const dueFrom = firstValue(params, SEARCH_PARAM_KEYS.dueFrom);
  const dueTo = firstValue(params, SEARCH_PARAM_KEYS.dueTo);

  const readinessParam = firstValue(params, SEARCH_PARAM_KEYS.readiness);
  const readiness = (DRAFT_READINESS_FILTERS as readonly string[]).includes(
    readinessParam ?? "",
  )
    ? (readinessParam as DraftReadiness)
    : null;

  const pageParam = Number.parseInt(
    firstValue(params, SEARCH_PARAM_KEYS.page) ?? "",
    10,
  );

  const filters: BillFilters = {
    tab,
    statuses,
    vendorIds: listValues(params, SEARCH_PARAM_KEYS.vendor),
    search: firstValue(params, SEARCH_PARAM_KEYS.search) ?? null,
    dueFrom: dueFrom && isDateInputValue(dueFrom) ? dueFrom : null,
    dueTo: dueTo && isDateInputValue(dueTo) ? dueTo : null,
    minAmountCents: parseAmountToCents(
      firstValue(params, SEARCH_PARAM_KEYS.min) ?? null,
    ),
    maxAmountCents: parseAmountToCents(
      firstValue(params, SEARCH_PARAM_KEYS.max) ?? null,
    ),
    // The flag only exists on drafts, so it is dropped on tabs without them.
    readiness: allowedStatuses.includes("DRAFT") ? readiness : null,
    sort,
    direction,
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };

  return filters;
}

/** The statuses the query should actually match. */
export function effectiveStatuses(filters: BillFilters): readonly BillStatus[] {
  return filters.statuses.length > 0
    ? filters.statuses
    : statusesForTab(filters.tab);
}

// ---------------------------------------------------------------------------
// Serialising back to a URL
// ---------------------------------------------------------------------------

/** Integer-only cents → "1234.56". Never divides through a float. */
export function centsToInputValue(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  return `${sign}${whole}.${String(fraction).padStart(2, "0")}`;
}

export type BillFiltersPatch = Partial<BillFilters>;

/**
 * Merge a patch and drop anything that equals the default, so the URL stays
 * short and two paths to the same view produce the same string.
 *
 * Any patch other than a bare page change resets to page 1 — filtering while
 * sitting on page 3 and landing on an empty page is a classic table bug.
 */
export function buildBillsSearchParams(
  filters: BillFilters,
  patch: BillFiltersPatch = {},
): URLSearchParams {
  const merged: BillFilters = { ...filters, ...patch };

  const patchKeys = Object.keys(patch);
  const onlyPageChanged =
    patchKeys.length > 0 && patchKeys.every((key) => key === "page");
  if (patchKeys.length > 0 && !onlyPageChanged && patch.page === undefined) {
    merged.page = 1;
  }

  // Switching tab invalidates any status/readiness narrowing scoped to the old
  // tab, and returns sorting to that tab's natural default.
  if (patch.tab !== undefined && patch.tab !== filters.tab) {
    const allowed = statusesForTab(merged.tab);
    merged.statuses = merged.statuses.filter((status) =>
      allowed.includes(status),
    );
    if (!allowed.includes("DRAFT")) merged.readiness = null;
    if (patch.sort === undefined && patch.direction === undefined) {
      const fallback = defaultSortForTab(merged.tab);
      merged.sort = fallback.sort;
      merged.direction = fallback.direction;
    }
  }

  const params = new URLSearchParams();

  if (merged.tab !== DEFAULT_INBOX_TAB) params.set(SEARCH_PARAM_KEYS.tab, merged.tab);
  for (const status of merged.statuses) {
    params.append(SEARCH_PARAM_KEYS.status, status);
  }
  for (const vendorId of merged.vendorIds) {
    params.append(SEARCH_PARAM_KEYS.vendor, vendorId);
  }
  if (merged.search) params.set(SEARCH_PARAM_KEYS.search, merged.search);
  if (merged.dueFrom) params.set(SEARCH_PARAM_KEYS.dueFrom, merged.dueFrom);
  if (merged.dueTo) params.set(SEARCH_PARAM_KEYS.dueTo, merged.dueTo);
  if (merged.minAmountCents !== null) {
    params.set(SEARCH_PARAM_KEYS.min, centsToInputValue(merged.minAmountCents));
  }
  if (merged.maxAmountCents !== null) {
    params.set(SEARCH_PARAM_KEYS.max, centsToInputValue(merged.maxAmountCents));
  }
  if (merged.readiness) params.set(SEARCH_PARAM_KEYS.readiness, merged.readiness);

  const naturalSort = defaultSortForTab(merged.tab);
  if (merged.sort !== naturalSort.sort || merged.direction !== naturalSort.direction) {
    params.set(SEARCH_PARAM_KEYS.sort, merged.sort);
    params.set(SEARCH_PARAM_KEYS.direction, merged.direction);
  }
  if (merged.page > 1) params.set(SEARCH_PARAM_KEYS.page, String(merged.page));

  return params;
}

export function buildBillsHref(
  filters: BillFilters,
  patch: BillFiltersPatch = {},
  pathname = "/bills",
): string {
  const query = buildBillsSearchParams(filters, patch).toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

// ---------------------------------------------------------------------------
// Describing the active filters
// ---------------------------------------------------------------------------

/** Everything except the tab, the sort and the page — i.e. the removable chips. */
export function activeFilterCount(filters: BillFilters): number {
  return (
    filters.statuses.length +
    filters.vendorIds.length +
    (filters.search ? 1 : 0) +
    (filters.dueFrom ? 1 : 0) +
    (filters.dueTo ? 1 : 0) +
    (filters.minAmountCents !== null ? 1 : 0) +
    (filters.maxAmountCents !== null ? 1 : 0) +
    (filters.readiness ? 1 : 0)
  );
}

export function hasActiveFilters(filters: BillFilters): boolean {
  return activeFilterCount(filters) > 0;
}

/** Reset every filter while keeping the tab and the sort the user chose. */
export const CLEARED_FILTERS: BillFiltersPatch = {
  statuses: [],
  vendorIds: [],
  search: null,
  dueFrom: null,
  dueTo: null,
  minAmountCents: null,
  maxAmountCents: null,
  readiness: null,
  page: 1,
};

export interface FilterChip {
  /** Stable key for React. */
  id: string;
  /** e.g. "Vendor" */
  group: string;
  /** e.g. "Acme Corp" */
  value: string;
  /** The patch that removes just this chip. */
  removePatch: BillFiltersPatch;
}

export interface FilterChipContext {
  vendorNameById?: Record<string, string>;
  /** Injected so this module stays free of `money.ts` formatting options. */
  formatAmount?: (cents: number) => string;
  formatDate?: (isoDate: string) => string;
}

/**
 * Turn the active filters into removable chips. Rendering-agnostic on purpose:
 * the caller supplies the formatters, this module supplies the semantics.
 */
export function activeFilterChips(
  filters: BillFilters,
  context: FilterChipContext = {},
): FilterChip[] {
  const vendorName = (id: string) => context.vendorNameById?.[id] ?? id;
  const amount = context.formatAmount ?? centsToInputValue;
  const date = context.formatDate ?? ((value: string) => value);

  const chips: FilterChip[] = [];

  if (filters.search) {
    chips.push({
      id: "search",
      group: "Search",
      value: filters.search,
      removePatch: { search: null },
    });
  }

  for (const status of filters.statuses) {
    chips.push({
      id: `status:${status}`,
      group: "Status",
      value: BILL_STATUS_META[status].label,
      removePatch: {
        statuses: filters.statuses.filter((value) => value !== status),
      },
    });
  }

  if (filters.readiness) {
    chips.push({
      id: "readiness",
      group: "Draft",
      value: filters.readiness === "READY" ? "Ready" : "Missing info",
      removePatch: { readiness: null },
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

  if (filters.dueFrom) {
    chips.push({
      id: "dueFrom",
      group: "Due on or after",
      value: date(filters.dueFrom),
      removePatch: { dueFrom: null },
    });
  }

  if (filters.dueTo) {
    chips.push({
      id: "dueTo",
      group: "Due on or before",
      value: date(filters.dueTo),
      removePatch: { dueTo: null },
    });
  }

  if (filters.minAmountCents !== null) {
    chips.push({
      id: "min",
      group: "Amount ≥",
      value: amount(filters.minAmountCents),
      removePatch: { minAmountCents: null },
    });
  }

  if (filters.maxAmountCents !== null) {
    chips.push({
      id: "max",
      group: "Amount ≤",
      value: amount(filters.maxAmountCents),
      removePatch: { maxAmountCents: null },
    });
  }

  return chips;
}
