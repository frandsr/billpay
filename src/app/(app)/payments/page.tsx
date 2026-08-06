import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { PaymentsRegister } from "@/components/payments/payments-register";

export const metadata: Metadata = { title: "Payments" };

/**
 * The payments register.
 *
 * `searchParams` is what makes the page dynamic, and every section and filter
 * is one of them — so the view a person is looking at is fully described by its
 * URL and can be pasted to a colleague, exactly as the bills inbox works.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <>
      <PageHeader
        title="Payments"
        description="What is leaving the bank, and when. Every payment carries its own lifecycle — scheduled, initiated, paid or failed — independent of the bill it settles."
      />
      <PaymentsRegister searchParams={params} />
    </>
  );
}
