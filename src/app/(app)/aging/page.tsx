import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { AgingReport } from "@/components/aging/aging-report";

export const metadata: Metadata = { title: "AP Aging" };

export default function AgingPage() {
  return (
    <>
      <PageHeader
        title="AP Aging"
        description="Outstanding balance by vendor and how long it has been sitting there."
      />
      <AgingReport />
    </>
  );
}
