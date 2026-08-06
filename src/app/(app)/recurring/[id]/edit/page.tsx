import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/common/page-header";
import {
  getRecurringTemplateForForm,
  toFormInput,
} from "@/server/queries/recurring";
import { RecurringForm } from "@/components/recurring/recurring-form";
import { getActiveGlAccounts, getActiveVendors } from "@/server/reference-data";

export const metadata: Metadata = { title: "Edit recurring template" };

export default async function EditRecurringPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [template, vendors, glAccounts] = await Promise.all([
    getRecurringTemplateForForm(id),
    getActiveVendors(),
    getActiveGlAccounts(),
  ]);

  if (!template) notFound();

  return (
    <>
      <PageHeader
        title="Edit recurring template"
        description="Changes apply to bills generated from here on. Drafts this template already produced are ordinary bills and are left untouched."
      />
      <RecurringForm
        templateId={template.id}
        initial={toFormInput(template)}
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
