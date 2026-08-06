"use client";

/**
 * The invoice DOCUMENT, next to the coding surface.
 *
 * GLOSSARY: an *invoice* is the file that backs a bill; it is never a synonym
 * for the Bill itself. This panel renders that file and nothing else — it reads
 * no amounts off the record, because the point of the side-by-side layout is
 * that a person compares the document against the coding.
 *
 * The detail page keeps this column sticky, so the viewer fills the visible
 * height and the work column scrolls past it.
 */

import { useState } from "react";
import {
  ExternalLink,
  FileText,
  FileX2,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { BillDetail } from "@/server/bill-detail";

export interface InvoicePreviewProps {
  bill: BillDetail;
}

/** Zoom levels the embedded PDF viewer is asked for, in percent. */
const ZOOM_STEPS = [75, 100, 125, 150, 200] as const;
const DEFAULT_ZOOM_INDEX = 1;

export function InvoicePreview({ bill }: InvoicePreviewProps) {
  const [zoomIndex, setZoomIndex] = useState<number>(DEFAULT_ZOOM_INDEX);

  const url = bill.invoiceFileUrl;
  const fileName = bill.invoiceFileName ?? url?.split("/").pop() ?? null;
  const zoom = ZOOM_STEPS[zoomIndex];

  if (!url) {
    return (
      <Card className="h-full">
        <CardHeader>
          <PanelTitle />
        </CardHeader>
        <CardContent className="pb-(--card-spacing)">
          <EmptyState
            icon={FileX2}
            title="No invoice document attached"
            description={
              <>
                This bill was {bill.source === "MANUAL" ? "entered by hand" : "ingested"}{" "}
                without a file. The coding on the right still applies — there is
                simply nothing to check it against here.
              </>
            }
            className="min-h-[20rem]"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTitle fileName={fileName} />

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Zoom out"
              aria-label="Zoom out"
              disabled={zoomIndex === 0}
              onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
            >
              <ZoomOut />
            </Button>
            <span className="text-muted-foreground w-10 text-center text-xs tabular-nums">
              {zoom}%
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Zoom in"
              aria-label="Zoom in"
              disabled={zoomIndex === ZOOM_STEPS.length - 1}
              onClick={() =>
                setZoomIndex((index) =>
                  Math.min(ZOOM_STEPS.length - 1, index + 1),
                )
              }
            >
              <ZoomIn />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Reset zoom"
              aria-label="Reset zoom"
              disabled={zoomIndex === DEFAULT_ZOOM_INDEX}
              onClick={() => setZoomIndex(DEFAULT_ZOOM_INDEX)}
            >
              <Maximize2 />
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink /> Open
              </a>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-(--card-spacing)">
        <div className="bg-muted/40 h-[calc(100svh-16rem)] min-h-[28rem] overflow-hidden rounded-lg ring-1 ring-foreground/10">
          {/*
            The zoom is part of the fragment the browser's PDF viewer reads, so
            changing it has to remount the frame — hence the key.
          */}
          <iframe
            key={zoom}
            src={`${url}#view=FitH&zoom=${zoom}&toolbar=0&navpanes=0`}
            title={`Invoice ${bill.billNumber} from ${bill.vendor.name}`}
            className="size-full"
          />
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          Can’t see the document?{" "}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Open {fileName ?? "the invoice"} in a new tab
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}

function PanelTitle({ fileName }: { fileName?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <FileText className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium">Invoice document</p>
        {fileName ? (
          <p className="text-muted-foreground truncate font-mono text-xs">
            {fileName}
          </p>
        ) : null}
      </div>
    </div>
  );
}
