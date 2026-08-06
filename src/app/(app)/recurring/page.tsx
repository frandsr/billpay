import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { RecurringList } from "@/components/recurring/recurring-list";

export const metadata: Metadata = { title: "Recurring bills" };

/**
 * Recurring bill templates. Shell only — `<RecurringList/>` is owned by
 * vertical E and reads its own data, so this page never needs to change as the
 * feature lands.
 */
export default function RecurringPage() {
  return (
    <>
      <PageHeader
        title="Recurring bills"
        description="Templates that generate a coded draft on a schedule — rent, subscriptions and premiums that arrive on the same day every period."
      />
      <RecurringList />
    </>
  );
}
