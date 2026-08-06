/**
 * Line items slot on the bill detail page.
 *
 * A thin Server Component: it loads the one piece of reference data the coding
 * surface needs beyond `BillDetail` and `glAccounts` — the saved allocation
 * templates — and hands everything to the client editor.
 *
 * The templates are fetched here rather than on the page because the page is
 * frozen and its props contract (`{ bill, glAccounts }`) is fixed. The read
 * lives in `src/server/actions/bill-edit.ts`, which vertical B owns;
 * `src/server/reference-data.ts` is foundation code and stays untouched.
 */

import type { GlAccount } from "@prisma/client";

import { LineItemTable } from "@/components/bills/line-item-table";
import { getAllocationTemplates } from "@/server/actions/bill-edit";
import type { BillDetail } from "@/server/bill-detail";

export interface LineItemsEditorProps {
  bill: BillDetail;
  glAccounts: GlAccount[];
}

export async function LineItemsEditor({
  bill,
  glAccounts,
}: LineItemsEditorProps) {
  const templates = await getAllocationTemplates();

  return (
    <LineItemTable bill={bill} glAccounts={glAccounts} templates={templates} />
  );
}
