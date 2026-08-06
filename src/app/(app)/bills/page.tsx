import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { BillsInbox } from "@/components/bills/bills-inbox";

export const metadata: Metadata = { title: "Bills" };

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <>
      <PageHeader
        title="Bills"
        description="Every payable, from draft through approval to payment."
      />
      <BillsInbox searchParams={params} />
    </>
  );
}
