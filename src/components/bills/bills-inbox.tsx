// STUB: implemented in the VERTICAL A phase (bills inbox & creation).
// Owner: Vertical A. This file, bill-status-badge.tsx and new-bill-form.tsx are
// the ONLY files vertical A owns inside src/components/bills/ — bill-header,
// line-items-editor and invoice-preview belong to vertical B.
//
// Expected behaviour: the AP inbox — tabs Drafts / Awaiting approval /
// Approved / History (History = PAID + REJECTED + ARCHIVED), filters by status,
// vendor, due date and amount plus sorting, all driven by URL `searchParams` so
// the list stays a Server Component. Dense table with vendor, bill number, due
// date + aging, amount, status badge from BILL_STATUS_META, the derived
// `Missing info` / `Ready` flag on drafts and the "X of N approved" indicator.
// Bulk selection with a count and a disabled-with-reason bulk action. Rows link
// to /bills/[id]. Renders its own data server-side.

import { StubPanel } from "@/components/common/stub-panel";

export interface BillsInboxProps {
  /** Route search params, forwarded so the phase can drive filters from the URL. */
  searchParams?: Record<string, string | string[] | undefined>;
}

export function BillsInbox(_props: BillsInboxProps) {
  return (
    <StubPanel
      title="Bills inbox"
      owner="Vertical A — bills inbox & creation"
      summary="Filterable table of every bill with status, aging, amount and approval progress."
    />
  );
}
