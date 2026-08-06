import Link from "next/link";
import { Repeat } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";

export default function RecurringTemplateNotFound() {
  return (
    <>
      <PageHeader title="Recurring template" />
      <EmptyState
        icon={Repeat}
        title="That template no longer exists"
        description="It may have been removed since this page was opened."
        action={
          <Button asChild>
            <Link href="/recurring">Back to recurring bills</Link>
          </Button>
        }
      />
    </>
  );
}
