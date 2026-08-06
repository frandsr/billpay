import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { VendorList } from "@/components/vendors/vendor-list";

export const metadata: Metadata = { title: "Vendors" };

export default function VendorsPage() {
  return (
    <>
      <PageHeader
        title="Vendors"
        description="Suppliers, their default payment terms and where their money goes."
      />
      <VendorList />
    </>
  );
}
