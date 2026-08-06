import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { VendorDetailView } from "@/components/vendors/vendor-detail";

export const metadata: Metadata = { title: "Vendor" };

export default async function VendorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <PageHeader
        title="Vendor"
        description="Payment details, default terms and every bill this supplier has sent."
      />
      <VendorDetailView vendorId={id} />
    </>
  );
}
