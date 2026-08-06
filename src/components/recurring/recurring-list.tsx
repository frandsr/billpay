import Link from "next/link";
import { Plus, Repeat, TriangleAlert } from "lucide-react";

import { GenerateAllDueButton } from "@/components/recurring/recurring-actions";
import { listRecurringTemplates } from "@/server/queries/recurring";
import { TemplateCard } from "@/components/recurring/template-card";
import { EmptyState } from "@/components/common/empty-state";
import { StatCard } from "@/components/common/stat-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { todayUtc } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { dueOccurrences, isDue } from "@/lib/recurring";

/**
 * Every recurring template, with the due ones called out.
 *
 * Reads its own data server-side and takes no props — the route is a shell.
 * "Due" is not read off a column: `isDue`/`dueOccurrences` decide it from the
 * schedule, so the page and the generator can never disagree about what is
 * owed.
 */
export async function RecurringList() {
  const templates = await listRecurringTemplates();
  const today = todayUtc();

  const dueTemplates = templates.filter((template) => isDue(template, today));
  const owedDrafts = dueTemplates.reduce(
    (total, template) => total + dueOccurrences(template, today).length,
    0,
  );
  const owedCents = dueTemplates.reduce(
    (total, template) =>
      total + template.amountCents * dueOccurrences(template, today).length,
    0,
  );
  const pausedCount = templates.filter((template) => !template.active).length;
  const generatedCount = templates.reduce(
    (total, template) => total + template._count.generatedBills,
    0,
  );

  if (templates.length === 0) {
    return (
      <EmptyState
        icon={Repeat}
        title="No recurring templates yet"
        description="Define rent, subscriptions and premiums once — vendor, amount, cadence and GL coding — and each period arrives as a coded draft instead of data entry."
        action={
          <Button asChild>
            <Link href="/recurring/new">
              <Plus data-icon="inline-start" />
              New template
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {dueTemplates.length > 0 ? (
        <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800/70 dark:bg-amber-950/40">
          <TriangleAlert className="text-amber-700 dark:text-amber-400" />
          <AlertTitle className="text-amber-900 dark:text-amber-200">
            {dueTemplates.length}{" "}
            {dueTemplates.length === 1 ? "template is" : "templates are"} due —{" "}
            {owedDrafts} draft {owedDrafts === 1 ? "bill" : "bills"} waiting to
            be generated
          </AlertTitle>
          <AlertDescription className="text-amber-800/90 dark:text-amber-300/90">
            Generating creates ordinary DRAFT bills, already coded from the
            template. They still go through approval and payment like any other
            bill.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Templates"
          value={templates.length}
          hint={
            pausedCount > 0
              ? `${templates.length - pausedCount} active · ${pausedCount} paused`
              : "All active"
          }
        />
        <StatCard
          label="Due now"
          value={dueTemplates.length}
          tone={dueTemplates.length > 0 ? "warning" : "default"}
          hint={
            owedDrafts > 0
              ? `${owedDrafts} draft ${owedDrafts === 1 ? "bill" : "bills"} owed`
              : "Nothing owed today"
          }
        />
        <StatCard
          label="Value waiting"
          value={formatCents(owedCents, { compact: true })}
          tone={owedCents > 0 ? "warning" : "default"}
          hint="Total of the drafts due to be generated"
        />
        <StatCard
          label="Bills generated"
          value={generatedCount}
          hint="Drafts produced by these templates so far"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Generation is an explicit action, not a background job — so a period&rsquo;s
          drafts land when accounts payable decides they should.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/recurring/new">
              <Plus data-icon="inline-start" />
              New template
            </Link>
          </Button>
          <GenerateAllDueButton dueCount={dueTemplates.length} />
        </div>
      </div>

      <div className="space-y-3">
        {templates.map((template) => (
          <TemplateCard key={template.id} template={template} today={today} />
        ))}
      </div>
    </div>
  );
}
