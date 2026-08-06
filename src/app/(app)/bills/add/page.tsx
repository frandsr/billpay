import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  PencilLine,
  Repeat,
  ScanText,
  Table2,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Add bills" };

interface IngestionChannel {
  href: string;
  title: string;
  icon: LucideIcon;
  /** When you would reach for this channel rather than one of the others. */
  when: string;
  /** What the channel actually leaves behind, so nobody expects a finished bill. */
  outcome: string;
  cta: string;
}

/**
 * The ways a bill can enter the system, in the order a person would reach for
 * them: with the invoice document in hand, with a batch from a spreadsheet, or
 * with neither.
 */
const CHANNELS: IngestionChannel[] = [
  {
    href: "/bills/upload",
    title: "Upload an invoice",
    icon: ScanText,
    when: "You have the invoice document — a PDF or a photo — and want the numbers read off it instead of retyped.",
    outcome:
      "Extraction opens a draft bill for you to check. It is a starting point, never a finished bill: an invoice whose lines do not add up to its total lands in Missing info and waits for you.",
    cta: "Upload an invoice",
  },
  {
    href: "/bills/import",
    title: "Import a spreadsheet",
    icon: Table2,
    when: "A batch arrives at once — an export from another system, or a statement your vendor sends as a CSV.",
    outcome:
      "Map the columns once, then review every row before a single bill is created.",
    cta: "Import a CSV",
  },
  {
    href: "/bills/new",
    title: "Enter a bill by hand",
    icon: PencilLine,
    when: "There is no document to work from, or the amount is a one-off you already know.",
    outcome:
      "The full form: vendor, dates, terms, and the line items that code the spend.",
    cta: "New bill",
  },
];

/**
 * Ingestion hub.
 *
 * OCR upload, CSV import and manual entry are three separate routes with no
 * common parent, so before this page existed the sidebar could only point at
 * one of them — and `/bills/upload` was the one nothing linked to. A hub keeps
 * the sidebar at one entry per job while making every channel reachable in a
 * single click.
 *
 * Static by design: it reads no data, so it needs no server component of its
 * own and stays out of the way of the pages it links to.
 */
export default function AddBillsPage() {
  return (
    <>
      <PageHeader
        title="Add bills"
        description="A bill is the payable record we owe a vendor. It can start from an invoice document, from a spreadsheet, or from nothing at all — pick the one that matches what you are holding."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {CHANNELS.map((channel) => {
          const Icon = channel.icon;

          return (
            <Card key={channel.href} className="justify-between">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="text-muted-foreground size-4" />
                  {channel.title}
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-2">
                <p className="text-sm">{channel.when}</p>
                <p className="text-muted-foreground text-sm">
                  {channel.outcome}
                </p>
              </CardContent>

              <CardContent>
                <Button asChild variant="outline">
                  <Link href={channel.href}>
                    {channel.cta}
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Repeat className="size-4 shrink-0" />
          Rent, subscriptions and premiums arrive on the same day every period —
          a recurring template raises those bills for you, so they never need
          adding at all.
        </p>
        <Button asChild variant="ghost" size="sm">
          <Link href="/recurring">
            Recurring templates
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </>
  );
}
