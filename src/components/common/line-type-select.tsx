"use client";

import { Package, Receipt } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LINE_TYPES,
  LINE_TYPE_META,
  normaliseLineType,
  type LineType,
} from "@/lib/line-type";
import { cn } from "@/lib/utils";

/**
 * The one control that sets a line's expense-vs-item type.
 *
 * Shared rather than reimplemented: the bill detail editor and the New bill
 * form are the two places a person sets this field, and two different-looking
 * pickers for one column would teach that they are two different fields. Same
 * options, same order, same icons as `<LineTypeBadge/>` renders afterwards.
 *
 * The trigger is the standard `h-8` select, so it drops into a table row
 * without making the row taller than the inputs beside it; give it a narrow
 * column and it stays compact on its own.
 */

const LINE_TYPE_ICONS: Record<LineType, typeof Receipt> = {
  EXPENSE: Receipt,
  ITEM: Package,
};

export function LineTypeSelect({
  id,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  id?: string;
  value: LineType;
  onChange: (value: LineType) => void;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  return (
    <Select
      value={value}
      // Normalised on the way out too: the state behind this control is only
      // ever a real member, whatever the event hands us.
      onValueChange={(next) => onChange(normaliseLineType(next))}
    >
      <SelectTrigger
        id={id}
        className={cn("w-full", className)}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LINE_TYPES.map((type) => {
          const Icon = LINE_TYPE_ICONS[type];
          return (
            <SelectItem key={type} value={type}>
              <Icon className="size-3.5" />
              {LINE_TYPE_META[type].label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
