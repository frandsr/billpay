import { Package, Receipt } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  LINE_TYPE_META,
  normaliseLineType,
  type LineType,
} from "@/lib/line-type";
import { cn } from "@/lib/utils";

/**
 * The expense-vs-item axis of a line, made readable at a glance.
 *
 * It used to be a grey `secondary` pill rendered identically for both types:
 * the feature was implemented, shown on every line, and invisible. Colour plus
 * an icon separate them — the icon matters because colour alone is not a label
 * — and the `title` carries the accounting meaning for whoever wants it.
 *
 * Shared between the bill line-item table and the recurring template detail so
 * the same distinction never renders two different ways.
 */
export function LineTypeBadge({
  lineType,
  className,
}: {
  lineType: LineType | string;
  className?: string;
}) {
  const type = normaliseLineType(lineType);
  const meta = LINE_TYPE_META[type];
  const Icon = type === "ITEM" ? Package : Receipt;

  return (
    <Badge
      variant="outline"
      className={cn("font-normal", meta.badgeClassName, className)}
      title={meta.description}
    >
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}
