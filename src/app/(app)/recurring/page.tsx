import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { RecurringList } from "@/components/recurring/recurring-list";

export const metadata: Metadata = { title: "Recurring bills" };

/**
 * Recurring bill templates. Shell only — `<RecurringList/>` reads its own data
 * server-side and owns the stats, the due callout and the generate actions.
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
