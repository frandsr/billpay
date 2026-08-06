import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronLeft } from "lucide-react";

import { NewBillForm } from "@/components/bills/new-bill-form";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { toDateInputValue, todayUtc } from "@/lib/dates";
import { getNewBillFormData } from "@/server/queries/bills";

export const metadata: Metadata = { title: "New bill" };

/**
 * Manual bill entry.
 *
 * Reference data and today's date are resolved here, on the server, and handed
 * to the form as plain values — so the client component has nothing to fetch
 * and its first render matches the markup that was streamed to it.
 */
export default async function NewBillPage() {
  const { vendors, glAccounts } = await getNewBillFormData();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Link
        href="/bills"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeft className="size-4" />
        Back to bills
      </Link>

      <PageHeader
        title="New bill"
        description="Enter a bill by hand. It is saved as a draft — nothing is submitted for approval until you say so."
      />

      {vendors.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No active vendors"
          description="A bill is always owed to a vendor. Add one before entering a bill."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/vendors">Go to vendors</Link>
            </Button>
          }
        />
      ) : (
        <NewBillForm
          vendors={vendors}
          glAccounts={glAccounts}
          defaultIssueDate={toDateInputValue(todayUtc())}
        />
      )}
    </div>
  );
}
