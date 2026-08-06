/**
 * Minimal PDF writer — enough for a one-page text-and-rules document.
 *
 * Shared by the two generators that produce invoice documents for the demo:
 * `generate-invoices.ts` (one placeholder per seeded bill) and
 * `generate-test-invoice.ts` (a single fixture to drop into OCR upload). It is
 * deliberately hand-rolled: a PDF library would be a runtime dependency the
 * app itself never needs, and these documents are text, rules and grey boxes.
 *
 * The whole file writes PDF 1.4 by hand — objects, a cross-reference table and
 * a trailer — using the two base-14 Helvetica fonts, which every reader has
 * built in, so no font has to be embedded.
 */

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

/** `F1` is Helvetica, `F2` is Helvetica-Bold. Both are base-14, never embedded. */
export type FontName = "F1" | "F2";

export class PdfPage {
  private ops: string[] = [];

  text(x: number, y: number, size: number, font: FontName, value: string) {
    this.ops.push(
      `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfString(value)}) Tj ET`,
    );
    return this;
  }

  textRight(x: number, y: number, size: number, font: FontName, value: string) {
    return this.text(x - measure(value, size, font), y, size, font, value);
  }

  gray(value: number) {
    this.ops.push(`${value} g`);
    return this;
  }

  rule(x1: number, y: number, x2: number, width = 0.6, gray = 0.75) {
    this.ops.push(
      `q ${gray} G ${width} w ${x1} ${y} m ${x2} ${y} l S Q`,
    );
    return this;
  }

  box(x: number, y: number, w: number, h: number, gray = 0.95) {
    // `g` is the grayscale fill operator; `rg` would need three operands.
    this.ops.push(`q ${gray} g ${x} ${y} ${w} ${h} re f Q`);
    return this;
  }

  toContentStream(): string {
    return this.ops.join("\n");
  }
}

function escapePdfString(value: string): string {
  return toAscii(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Helvetica in StandardEncoding: keep the text 7-bit to stay predictable. */
export function toAscii(value: string): string {
  return value
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "");
}

/** Rough Helvetica advance width. Good enough for right-aligned columns. */
export function measure(value: string, size: number, font: FontName): number {
  const factor = font === "F2" ? 0.55 : 0.5;
  return toAscii(value).length * size * factor;
}

/** Assemble one page into a complete, single-page PDF file. */
export function buildPdf(page: PdfPage): Buffer {
  const content = page.toContentStream();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
