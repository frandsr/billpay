import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { DashboardSummary } from "@/components/dashboard/dashboard-summary";
import { getCurrentUser } from "@/lib/current-user";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const currentUser = await getCurrentUser();

  return (
    <>
      <PageHeader
        title={`Good to see you, ${currentUser.name.split(" ")[0]}`}
        description="What accounts payable needs from you today."
      />
      <DashboardSummary currentUser={currentUser} />
    </>
  );
}
