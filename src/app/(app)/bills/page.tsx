import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { BillsInbox } from "@/components/bills/bills-inbox";
import { Button } from "@/components/ui/button";

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
        actions={
          <Button asChild>
            <Link href="/bills/new">
              <Plus data-icon="inline-start" />
              New bill
            </Link>
          </Button>
        }
      />
      <BillsInbox searchParams={params} />
    </>
  );
}
