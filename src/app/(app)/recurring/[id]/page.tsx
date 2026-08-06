import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { RecurringDetail } from "@/components/recurring/recurring-detail";

export const metadata: Metadata = { title: "Recurring template" };

export default async function RecurringTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <PageHeader
        title="Recurring template"
        description="What this template will produce, and every bill it has produced so far."
      />
      <RecurringDetail templateId={id} />
    </>
  );
}
