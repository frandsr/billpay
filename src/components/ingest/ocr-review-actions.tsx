"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IngestActionState, OcrFieldKey, VendorCandidate } from "@/lib/ocr-schema";
import { applyExtractedFieldAction, rerunExtractionAction } from "@/server/actions/ingest";

/**
 * The interactive controls in the OCR review panel.
 *
 * Each one applies exactly ONE extracted value to the bill, on an explicit
 * click. There is deliberately no "accept everything": ADR 0010 puts a human
 * between an extraction and a saved bill, and a bulk-accept button would be a
 * one-click way around that.
 */

const IDLE: IngestActionState = { status: "idle" };

export interface ApplyFieldButtonProps {
  billId: string;
  field: OcrFieldKey;
  label: string;
  disabled?: boolean;
}

export function ApplyFieldButton({ billId, field, label, disabled }: ApplyFieldButtonProps) {
  const [state, action, pending] = useActionState<IngestActionState, FormData>(
    applyExtractedFieldAction,
    IDLE,
  );
  useToastFor(state);

  return (
    <form action={action}>
      <input type="hidden" name="billId" value={billId} />
      <input type="hidden" name="field" value={field} />
      <Button
        type="submit"
        variant="outline"
        size="xs"
        disabled={disabled || pending}
        aria-label={`Apply the extracted ${label.toLowerCase()} to this bill`}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Check />}
        Apply
      </Button>
    </form>
  );
}

export interface ApplyVendorControlProps {
  billId: string;
  candidates: VendorCandidate[];
  suggestedVendorId: string | null;
  currentVendorId: string;
  disabled?: boolean;
}

/**
 * The vendor row.
 *
 * A read name is not a vendor id, so the reviewer picks which existing vendor
 * the extracted name means. An unmatched name never creates a vendor — that is
 * a deliberate dead end, not a missing feature.
 */
export function ApplyVendorControl({
  billId,
  candidates,
  suggestedVendorId,
  currentVendorId,
  disabled,
}: ApplyVendorControlProps) {
  const [state, action, pending] = useActionState<IngestActionState, FormData>(
    applyExtractedFieldAction,
    IDLE,
  );
  const [vendorId, setVendorId] = useState(suggestedVendorId ?? "");
  useToastFor(state);

  const options = candidates.filter((candidate) => candidate.id !== currentVendorId);

  if (options.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">no match</span>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="billId" value={billId} />
      <input type="hidden" name="field" value="vendorName" />
      <Select name="vendorId" value={vendorId} onValueChange={setVendorId}>
        <SelectTrigger size="sm" className="w-40" aria-label="Vendor to apply">
          <SelectValue placeholder="Pick a vendor" />
        </SelectTrigger>
        <SelectContent>
          {options.map((candidate) => (
            <SelectItem key={candidate.id} value={candidate.id}>
              {candidate.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="submit"
        variant="outline"
        size="xs"
        disabled={disabled || pending || vendorId === ""}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Check />}
        Apply
      </Button>
    </form>
  );
}

export interface RerunExtractionButtonProps {
  billId: string;
  disabled?: boolean;
}

export function RerunExtractionButton({ billId, disabled }: RerunExtractionButtonProps) {
  const [state, action, pending] = useActionState<IngestActionState, FormData>(
    rerunExtractionAction,
    IDLE,
  );
  useToastFor(state);

  return (
    <form action={action}>
      <input type="hidden" name="billId" value={billId} />
      <Button type="submit" variant="ghost" size="xs" disabled={disabled || pending}>
        {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {pending ? "Re-reading…" : "Re-run extraction"}
      </Button>
    </form>
  );
}

/** One toast per completed action, success or failure. */
function useToastFor(state: IngestActionState) {
  useEffect(() => {
    if (state.status === "done") toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);
}
