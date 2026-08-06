"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, CalendarClock, CheckCircle2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PaymentMethod, PaymentStatus } from "@/lib/domain";
import {
  completePayment,
  failPayment,
  initiatePayment,
  schedulePayment,
} from "@/server/actions/payments";

/**
 * The interactive parts of the payment panel.
 *
 * Which methods are offered, and which are disabled for want of vendor payment
 * details, is decided on the server and passed in — the same check runs again
 * inside `schedulePayment`, so an enabled-looking option proves nothing.
 */

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export interface PaymentMethodOption {
  method: PaymentMethod;
  label: string;
  hint: string;
  /** Why this method is unavailable for this vendor, or null when it is fine. */
  blockedReason: string | null;
}

export interface SchedulePaymentFormProps {
  billId: string;
  options: PaymentMethodOption[];
  /** "yyyy-MM-dd" — derived from the bill's due date. */
  defaultDate: string;
  /** "yyyy-MM-dd" — today; the server refuses anything earlier. */
  minDate: string;
}

export function SchedulePaymentForm({
  billId,
  options,
  defaultDate,
  minDate,
}: SchedulePaymentFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const firstAvailable =
    options.find((option) => option.blockedReason === null) ?? null;
  const [method, setMethod] = useState<string>(firstAvailable?.method ?? "");
  const [date, setDate] = useState(defaultDate);

  const selected = options.find((option) => option.method === method) ?? null;

  function submit() {
    startTransition(async () => {
      const result = await schedulePayment(billId, method, date);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="payment-method">Method</Label>
          <Select value={method} onValueChange={setMethod} disabled={isPending}>
            <SelectTrigger id="payment-method" className="w-full">
              <SelectValue placeholder="Choose a method" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem
                  key={option.method}
                  value={option.method}
                  disabled={option.blockedReason !== null}
                >
                  {option.label}
                  {option.blockedReason ? " — details missing" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="payment-date">Send date</Label>
          <Input
            id="payment-date"
            type="date"
            value={date}
            min={minDate}
            onChange={(event) => setDate(event.target.value)}
            disabled={isPending}
          />
        </div>
      </div>

      {selected ? (
        <p className="text-muted-foreground text-xs">{selected.hint}</p>
      ) : null}

      <Button
        onClick={submit}
        disabled={isPending || method === "" || date === ""}
        size="lg"
      >
        <CalendarClock data-icon="inline-start" />
        {isPending ? "Scheduling…" : "Schedule payment"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export interface PaymentExecutionActionsProps {
  paymentId: string;
  status: PaymentStatus;
}

export function PaymentExecutionActions({
  paymentId,
  status,
}: PaymentExecutionActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [failOpen, setFailOpen] = useState(false);
  const [reason, setReason] = useState("");

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message);
        setFailOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "SCHEDULED" ? (
        <Button
          variant="outline"
          size="lg"
          disabled={isPending}
          onClick={() => run(() => initiatePayment(paymentId))}
        >
          <Send data-icon="inline-start" />
          Initiate
        </Button>
      ) : null}

      <Button
        size="lg"
        disabled={isPending}
        onClick={() => run(() => completePayment(paymentId))}
      >
        <CheckCircle2 data-icon="inline-start" />
        {isPending ? "Working…" : "Mark as paid"}
      </Button>

      <Dialog open={failOpen} onOpenChange={setFailOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive" size="lg" disabled={isPending}>
            <Ban data-icon="inline-start" />
            Mark as failed
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark this payment as failed</DialogTitle>
            <DialogDescription>
              The bill stays approved and unpaid, so a replacement payment can be
              scheduled.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="failure-reason">Reason</Label>
            <Textarea
              id="failure-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Returned by the bank — account closed."
              disabled={isPending}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={isPending || reason.trim() === ""}
              onClick={() => run(() => failPayment(paymentId, reason))}
            >
              {isPending ? "Working…" : "Mark as failed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
