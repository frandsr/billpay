import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { ImportWizard } from "@/components/ingest/import-wizard";

export const metadata: Metadata = { title: "Import bills" };

/**
 * CSV import. Shell only — `<ImportWizard/>` is owned by vertical D and reads
 * its own data, so this page never needs to change as the feature lands.
 */
export default function ImportBillsPage() {
  return (
    <>
      <PageHeader
        title="Import bills"
        description="Bring a batch of bills in from a CSV: map the columns once, then check every row before anything is created."
      />
      <ImportWizard />
    </>
  );
}
