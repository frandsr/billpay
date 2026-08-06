import { Construction } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StubPanelProps {
  /** What this slot will contain, e.g. "Bills inbox". */
  title: string;
  /**
   * Which vertical fills it, e.g. "Vertical A — bills inbox & creation".
   * Rendered verbatim so the running app documents its own ownership map.
   */
  owner: string;
  /** One line on what the finished component does. */
  summary: string;
  className?: string;
}

/**
 * Placeholder rendered by every stub component created in the foundation
 * phase. Keeps the app navigable end to end while the verticals run in
 * parallel — nothing crashes, and each empty slot names its owner.
 *
 * Delete the stub (and this import) as each slot is filled.
 */
export function StubPanel({ title, owner, summary, className }: StubPanelProps) {
  return (
    <Card
      className={cn(
        "border-dashed bg-transparent p-6 shadow-none",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
          <Construction className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground text-sm">{summary}</p>
          <p className="text-muted-foreground/80 font-mono text-[11px]">
            Coming soon — owned by {owner}.
          </p>
        </div>
      </div>
    </Card>
  );
}
