import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

export default function BillNotFound() {
  return (
    <EmptyState
      icon={FileQuestion}
      title="Bill not found"
      description="This bill may have been archived, or the link is out of date."
      action={
        <Button asChild size="sm">
          <Link href="/bills">Back to bills</Link>
        </Button>
      }
      className="mt-16"
    />
  );
}
