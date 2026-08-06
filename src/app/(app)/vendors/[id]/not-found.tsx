import Link from "next/link";
import { Building2 } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";

export default function VendorNotFound() {
  return (
    <>
      <PageHeader title="Vendor" />
      <EmptyState
        icon={Building2}
        title="That vendor no longer exists"
        description="It may have been removed since this page was opened."
        action={
          <Button asChild>
            <Link href="/vendors">Back to vendors</Link>
          </Button>
        }
      />
    </>
  );
}
