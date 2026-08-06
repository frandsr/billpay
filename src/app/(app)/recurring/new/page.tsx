import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { RecurringForm } from "@/components/recurring/recurring-form";
import { getActiveGlAccounts, getActiveVendors } from "@/server/reference-data";

export const metadata: Metadata = { title: "New recurring template" };

export default async function NewRecurringPage() {
  const [vendors, glAccounts] = await Promise.all([
    getActiveVendors(),
    getActiveGlAccounts(),
  ]);

  return (
    <>
      <PageHeader
        title="New recurring template"
        description="Define the vendor, the amount, the cadence and the GL coding once. Every period then arrives as a coded draft for accounts payable to review rather than retype."
      />
      <RecurringForm
        vendors={vendors.map((vendor) => ({
          id: vendor.id,
          name: vendor.name,
          defaultPaymentTerms: vendor.defaultPaymentTerms,
          defaultGlAccountId: vendor.defaultGlAccountId,
        }))}
        glAccounts={glAccounts.map((account) => ({
          id: account.id,
          code: account.code,
          name: account.name,
        }))}
      />
    </>
  );
}
