import { PAYMENT_TERMS_LABELS, dueDateFrom, fromDateInputValue } from "@/lib/dates";
import type { PaymentTerms } from "@/lib/domain";
import { lineAmountCents, parseAmountToCents, sumCents } from "@/lib/money";
import {
  asPaymentTerms,
  normalizeCurrency,
  normalizeDateString,
  normalizeName,
  toIsoDate,
} from "@/lib/ocr-schema";

/**
 * CSV bill import — parsing and validation.
 *
 * The unit of a CSV row is a LINE ITEM, not a bill: rows sharing a
 * (vendor, bill number) pair collapse into one bill with several lines. That is
 * how accounting systems export payables, and it means a two-line invoice needs
 * no nested syntax in a flat file.
 *
 * Nothing here writes. `buildImportPreview` produces the complete picture — what
 * would be created, and every reason a row cannot be — so the wizard can show it
 * BEFORE anything is committed, and so the server can re-run the identical check
 * on the raw text rather than trusting a client-side parse.
 *
 * Money never passes through `parseFloat`: amounts go through
 * `parseAmountToCents`, dates through `fromDateInputValue`, and the due date is
 * always derived with `dueDateFrom(issueDate, terms)`.
 *
 * PURE MODULE: no Prisma, no React, no `next/*`, no I/O.
 */

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export type ImportColumnKey =
  | "vendorName"
  | "billNumber"
  | "issueDate"
  | "paymentTerms"
  | "totalAmount"
  | "currency"
  | "memo"
  | "lineDescription"
  | "lineQuantity"
  | "lineUnitPrice"
  | "lineGlCode"
  | "lineDepartment";

export interface ImportColumn {
  key: ImportColumnKey;
  /** Canonical header written into the downloadable template. */
  header: string;
  required: boolean;
  /** Whether the value belongs to the BILL (repeated on every row of a bill)
   *  or to the LINE (distinct per row). */
  scope: "bill" | "line";
  description: string;
  /** Accepted header spellings, normalised. The canonical header is implied. */
  aliases: string[];
  example: string;
}

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  {
    key: "vendorName",
    header: "vendor",
    required: true,
    scope: "bill",
    description:
      "Must match an existing active vendor by name. Unknown vendors are reported, never created.",
    aliases: ["vendorname", "suppliername", "supplier", "payee"],
    example: "Figma",
  },
  {
    key: "billNumber",
    header: "bill_number",
    required: true,
    scope: "bill",
    description:
      "The supplier's invoice number. Unique per vendor — a repeat is reported as a duplicate.",
    aliases: ["billno", "invoicenumber", "invoiceno", "invoice", "number", "reference"],
    example: "FIG-20544",
  },
  {
    key: "issueDate",
    header: "issue_date",
    required: true,
    scope: "bill",
    description: "Invoice date, YYYY-MM-DD. The due date is derived from it and the terms.",
    aliases: ["date", "invoicedate", "billdate"],
    example: "2026-07-01",
  },
  {
    key: "paymentTerms",
    header: "payment_terms",
    required: true,
    scope: "bill",
    description: `One of ${Object.keys(PAYMENT_TERMS_LABELS).join(", ")}. "Net 30" and "net30" are accepted too.`,
    aliases: ["terms", "term", "nettterms", "netterms"],
    example: "NET_30",
  },
  {
    key: "totalAmount",
    header: "total",
    required: true,
    scope: "bill",
    description:
      "The authoritative amount owed. Repeated on every row of a multi-line bill and must agree across them.",
    aliases: ["totalamount", "amount", "amountdue", "grandtotal", "invoicetotal"],
    example: "1,200.00",
  },
  {
    key: "currency",
    header: "currency",
    required: false,
    scope: "bill",
    description: "ISO-4217 code. Defaults to USD.",
    aliases: ["ccy", "currencycode"],
    example: "USD",
  },
  {
    key: "memo",
    header: "memo",
    required: false,
    scope: "bill",
    description: "Free-text note carried onto the bill.",
    aliases: ["note", "notes", "description", "billmemo"],
    example: "Design seats — July",
  },
  {
    key: "lineDescription",
    header: "line_description",
    required: true,
    scope: "line",
    description: "What this line is for. One row per line item.",
    aliases: ["linedesc", "itemdescription", "item", "lineitem"],
    example: "Figma Organization — 8 seats",
  },
  {
    key: "lineQuantity",
    header: "line_quantity",
    required: false,
    scope: "line",
    description: "Whole number. Defaults to 1.",
    aliases: ["quantity", "qty", "lineqty"],
    example: "8",
  },
  {
    key: "lineUnitPrice",
    header: "line_unit_price",
    required: true,
    scope: "line",
    description: "Price per unit. The line amount is quantity x unit price.",
    aliases: ["unitprice", "price", "rate", "lineprice", "unitcost"],
    example: "150.00",
  },
  {
    key: "lineGlCode",
    header: "line_gl_code",
    required: false,
    scope: "line",
    description:
      "Chart-of-accounts code for this line. Unknown codes are reported, never guessed. A line with no code lands as Missing info.",
    aliases: ["glcode", "gl", "account", "accountcode", "glaccount"],
    example: "6100",
  },
  {
    key: "lineDepartment",
    header: "line_department",
    required: false,
    scope: "line",
    description: "Free-form dimension, e.g. Design.",
    aliases: ["department", "dept", "dimension", "costcenter"],
    example: "Design",
  },
] as const;

const COLUMN_BY_KEY = new Map<ImportColumnKey, ImportColumn>(
  IMPORT_COLUMNS.map((column) => [column.key, column]),
);

export function importColumn(key: ImportColumnKey): ImportColumn {
  const column = COLUMN_BY_KEY.get(key);
  if (!column) throw new Error(`Unknown import column: ${key}`);
  return column;
}

/** Header text reduced to a comparable token: "Bill Number" -> "billnumber". */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/^\uFEFF/, "").replace(/[^a-z0-9]/g, "");
}

/**
 * The downloadable template: the canonical headers plus two example rows, the
 * second of which is a SECOND LINE on the first bill — the multi-line shape is
 * the part people get wrong, so the sample demonstrates it.
 */
export function buildImportTemplateCsv(): string {
  const sampleRows: Record<ImportColumnKey, string>[] = [
    // A two-line bill: both rows repeat the same vendor, number, date, terms
    // and total, and differ only in their line columns.
    {
      vendorName: "Figma",
      billNumber: "FIG-20544",
      issueDate: "2026-07-01",
      paymentTerms: "NET_30",
      totalAmount: "1,200.00",
      currency: "USD",
      memo: "Design seats — July",
      lineDescription: "Figma Organization — 8 seats",
      lineQuantity: "8",
      lineUnitPrice: "120.00",
      lineGlCode: "6100",
      lineDepartment: "Design",
    },
    {
      vendorName: "Figma",
      billNumber: "FIG-20544",
      issueDate: "2026-07-01",
      paymentTerms: "NET_30",
      totalAmount: "1,200.00",
      currency: "USD",
      memo: "Design seats — July",
      lineDescription: "Figma Professional — 4 seats",
      lineQuantity: "4",
      lineUnitPrice: "60.00",
      lineGlCode: "6100",
      lineDepartment: "Design",
    },
    // A single-line bill.
    {
      vendorName: "Slack Technologies",
      billNumber: "SLK-88120",
      issueDate: "2026-07-03",
      paymentTerms: "NET_30",
      totalAmount: "980.00",
      currency: "USD",
      memo: "Slack Pro — July",
      lineDescription: "Slack Pro — 49 seats",
      lineQuantity: "49",
      lineUnitPrice: "20.00",
      lineGlCode: "6100",
      lineDepartment: "Engineering",
    },
  ];

  const rows = [
    IMPORT_COLUMNS.map((column) => column.header),
    ...sampleRows.map((sample) => IMPORT_COLUMNS.map((column) => sample[column.key])),
  ];

  return `${rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n")}\n`;
}

function escapeCsvValue(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// ---------------------------------------------------------------------------
// Delimited parsing (RFC 4180-ish)
// ---------------------------------------------------------------------------

export interface DelimitedFile {
  header: string[];
  /** Data rows, each padded/truncated to the header width. */
  rows: string[][];
  /** 1-based line number in the source file for each data row. */
  lineNumbers: number[];
  delimiter: string;
}

/**
 * Parse CSV (or TSV/semicolon) text: quoted fields, escaped quotes, embedded
 * newlines, CRLF, and a UTF-8 BOM. Blank lines are dropped rather than becoming
 * a row of empty errors.
 */
export function parseDelimited(text: string): DelimitedFile {
  const clean = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(clean);

  const records: { fields: string[]; line: number }[] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let touched = false;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    const isBlank = record.every((value) => value.trim() === "");
    if (!isBlank) records.push({ fields: record, line: recordLine });
    record = [];
    touched = false;
    recordLine = line;
  };

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];

    if (!touched) {
      recordLine = line;
      touched = true;
    }

    if (inQuotes) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === "") {
      field = "";
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      endField();
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      line += 1;
      endRecord();
      continue;
    }
    field += char;
  }

  if (touched || field !== "" || record.length > 0) endRecord();

  const headerRecord = records.shift();
  const header = (headerRecord?.fields ?? []).map((value) => value.trim());
  const width = header.length;

  return {
    header,
    rows: records.map(({ fields }) => {
      const padded = fields.slice(0, width).map((value) => value.trim());
      while (padded.length < width) padded.push("");
      return padded;
    }),
    lineNumbers: records.map(({ line: recordStart }) => recordStart),
    delimiter,
  };
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: [string, number][] = [
    [",", (firstLine.match(/,/g) ?? []).length],
    [";", (firstLine.match(/;/g) ?? []).length],
    ["\t", (firstLine.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ImportReferenceData {
  vendors: readonly { id: string; name: string }[];
  glAccounts: readonly { id: string; code: string; name: string }[];
  /** `${vendorId}::${billNumber.toLowerCase()}` for every bill already stored. */
  existingBillKeys: readonly string[];
}

export interface ImportIssue {
  /** 1-based line in the source file, so the message points at the user's row. */
  line: number;
  column?: ImportColumnKey;
  message: string;
}

export interface ImportLineDraft {
  line: number;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  glAccountId: string | null;
  glCode: string | null;
  department: string | null;
}

export interface ImportBillDraft {
  /** Stable identity within one preview, used as a React key. */
  key: string;
  lines: ImportLineDraft[];
  /** Source line numbers that fed this bill. */
  sourceLines: number[];

  vendorId: string | null;
  vendorName: string;
  billNumber: string;
  /** "yyyy-MM-dd". */
  issueDate: string | null;
  dueDate: string | null;
  paymentTerms: PaymentTerms | null;
  totalCents: number | null;
  currency: string;
  memo: string | null;

  /** Blocking. A bill with any error is not created. */
  errors: ImportIssue[];
  /** Non-blocking. The bill is created and lands in `Missing info`. */
  warnings: ImportIssue[];
  valid: boolean;
}

export interface ImportPreview {
  /** Problems with the file as a whole (empty, no header, missing columns). */
  fileErrors: string[];
  /** Canonical -> actual header, for the "we read your file like this" strip. */
  mapping: { key: ImportColumnKey; header: string | null }[];
  /** Headers we could not map onto a bill field. Ignored, not fatal. */
  unmappedHeaders: string[];
  bills: ImportBillDraft[];
  rowCount: number;
  validCount: number;
  invalidCount: number;
}

export function buildBillKey(vendorId: string, billNumber: string): string {
  return `${vendorId}::${billNumber.trim().toLowerCase()}`;
}

/**
 * Parse and validate an import file end to end.
 *
 * Every failure is attached to the row that caused it; nothing throws, because
 * a bad file is a normal outcome the wizard has to render, not an exception.
 */
export function buildImportPreview(
  text: string,
  reference: ImportReferenceData,
): ImportPreview {
  const empty: ImportPreview = {
    fileErrors: [],
    mapping: IMPORT_COLUMNS.map((column) => ({ key: column.key, header: null })),
    unmappedHeaders: [],
    bills: [],
    rowCount: 0,
    validCount: 0,
    invalidCount: 0,
  };

  if (!text.trim()) {
    return { ...empty, fileErrors: ["The file is empty."] };
  }

  const file = parseDelimited(text);
  if (file.header.length === 0) {
    return { ...empty, fileErrors: ["The file has no header row."] };
  }

  // --- map headers -------------------------------------------------------
  const indexByKey = new Map<ImportColumnKey, number>();
  const usedIndexes = new Set<number>();

  for (const column of IMPORT_COLUMNS) {
    const accepted = new Set([normalizeHeader(column.header), ...column.aliases]);
    const index = file.header.findIndex(
      (header, position) =>
        !usedIndexes.has(position) && accepted.has(normalizeHeader(header)),
    );
    if (index !== -1) {
      indexByKey.set(column.key, index);
      usedIndexes.add(index);
    }
  }

  const mapping = IMPORT_COLUMNS.map((column) => ({
    key: column.key,
    header: indexByKey.has(column.key)
      ? file.header[indexByKey.get(column.key) as number]
      : null,
  }));
  const unmappedHeaders = file.header.filter(
    (header, position) => !usedIndexes.has(position) && header.trim() !== "",
  );

  const missing = IMPORT_COLUMNS.filter(
    (column) => column.required && !indexByKey.has(column.key),
  );
  if (missing.length > 0) {
    return {
      ...empty,
      mapping,
      unmappedHeaders,
      fileErrors: [
        `The file is missing required ${missing.length === 1 ? "column" : "columns"}: ${missing
          .map((column) => column.header)
          .join(", ")}. Download the template to see the expected header row.`,
      ],
    };
  }

  if (file.rows.length === 0) {
    return { ...empty, mapping, unmappedHeaders, fileErrors: ["The file has a header but no rows."] };
  }

  // --- lookups -----------------------------------------------------------
  const vendorByNormalized = new Map<string, { id: string; name: string }>();
  for (const vendor of reference.vendors) {
    vendorByNormalized.set(normalizeName(vendor.name), vendor);
  }
  const glByCode = new Map<string, { id: string; code: string; name: string }>();
  for (const account of reference.glAccounts) {
    glByCode.set(account.code.trim().toLowerCase(), account);
  }
  const existingKeys = new Set(reference.existingBillKeys);

  const cell = (row: string[], key: ImportColumnKey): string => {
    const index = indexByKey.get(key);
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  // --- group rows into bills --------------------------------------------
  const drafts = new Map<string, ImportBillDraft>();
  const order: string[] = [];

  file.rows.forEach((row, position) => {
    const line = file.lineNumbers[position] ?? position + 2;

    const vendorName = cell(row, "vendorName");
    const billNumber = cell(row, "billNumber");
    const vendor = vendorByNormalized.get(normalizeName(vendorName)) ?? null;

    // Group on the raw text, so rows for an unknown vendor still collapse into
    // one reported bill instead of N identical errors.
    const groupKey = `${normalizeName(vendorName)}::${billNumber.toLowerCase()}`;

    let draft = drafts.get(groupKey);
    if (!draft) {
      draft = {
        key: groupKey,
        lines: [],
        sourceLines: [],
        vendorId: vendor?.id ?? null,
        vendorName: vendorName || "(no vendor)",
        billNumber,
        issueDate: null,
        dueDate: null,
        paymentTerms: null,
        totalCents: null,
        currency: "USD",
        memo: null,
        errors: [],
        warnings: [],
        valid: false,
      };
      drafts.set(groupKey, draft);
      order.push(groupKey);

      // Header-level validation runs once, on the row that opened the bill.
      applyBillFields(draft, row, line, cell, vendor, vendorName, billNumber);
    } else {
      assertConsistentHeader(draft, row, line, cell);
    }

    draft.sourceLines.push(line);
    applyLine(draft, row, line, cell, glByCode);
  });

  // --- cross-bill checks --------------------------------------------------
  const bills = order.map((key) => drafts.get(key) as ImportBillDraft);

  for (const draft of bills) {
    const firstLine = draft.sourceLines[0] ?? 0;

    if (draft.lines.length === 0) {
      draft.errors.push({ line: firstLine, message: "No usable line items." });
    }

    if (draft.vendorId && draft.billNumber) {
      const key = buildBillKey(draft.vendorId, draft.billNumber);
      if (existingKeys.has(key)) {
        draft.errors.push({
          line: firstLine,
          column: "billNumber",
          message: `${draft.vendorName} already has a bill numbered ${draft.billNumber}. Bill numbers are unique per vendor.`,
        });
      }
    }

    // ADR 0004: a mismatch is a WARNING, not an error. The bill is created and
    // lands in `Missing info` for a human to resolve — the total is never
    // rewritten from the lines, and the lines are never padded to fit.
    const lineTotal = sumCents(draft.lines.map((line) => line.amountCents));
    if (draft.totalCents !== null && draft.lines.length > 0 && lineTotal !== draft.totalCents) {
      draft.warnings.push({
        line: firstLine,
        message: `Line items sum to ${formatPlain(lineTotal)} but the bill total is ${formatPlain(draft.totalCents)}. The bill total wins; the draft will land in Missing info.`,
      });
    }

    const uncoded = draft.lines.filter((line) => !line.glAccountId).length;
    if (uncoded > 0) {
      draft.warnings.push({
        line: firstLine,
        column: "lineGlCode",
        message: `${uncoded} ${uncoded === 1 ? "line has" : "lines have"} no GL account. The draft will land in Missing info.`,
      });
    }

    draft.valid = draft.errors.length === 0;
  }

  const validCount = bills.filter((draft) => draft.valid).length;

  return {
    fileErrors: [],
    mapping,
    unmappedHeaders,
    bills,
    rowCount: file.rows.length,
    validCount,
    invalidCount: bills.length - validCount,
  };
}

type CellReader = (row: string[], key: ImportColumnKey) => string;

function applyBillFields(
  draft: ImportBillDraft,
  row: string[],
  line: number,
  cell: CellReader,
  vendor: { id: string; name: string } | null,
  vendorName: string,
  billNumber: string,
): void {
  if (!vendorName) {
    draft.errors.push({ line, column: "vendorName", message: "Vendor is required." });
  } else if (!vendor) {
    draft.errors.push({
      line,
      column: "vendorName",
      message: `Unknown vendor "${vendorName}". Create the vendor first — an import never creates one.`,
    });
  } else {
    draft.vendorName = vendor.name;
  }

  if (!billNumber) {
    draft.errors.push({ line, column: "billNumber", message: "Bill number is required." });
  }

  const currency = cell(row, "currency");
  draft.currency = normalizeCurrency(currency || "USD");
  if (currency && draft.currency !== currency.trim().toUpperCase()) {
    draft.warnings.push({
      line,
      column: "currency",
      message: `Currency "${currency}" is not supported; the draft assumes ${draft.currency}.`,
    });
  }

  const issueRaw = cell(row, "issueDate");
  const issueDate = normalizeDateString(issueRaw);
  if (!issueRaw) {
    draft.errors.push({ line, column: "issueDate", message: "Issue date is required." });
  } else if (!issueDate) {
    draft.errors.push({
      line,
      column: "issueDate",
      message: `"${issueRaw}" is not a date. Use YYYY-MM-DD.`,
    });
  } else {
    draft.issueDate = issueDate;
  }

  const termsRaw = cell(row, "paymentTerms");
  const terms = asPaymentTerms(termsRaw);
  if (!termsRaw) {
    draft.errors.push({ line, column: "paymentTerms", message: "Payment terms are required." });
  } else if (!terms) {
    draft.errors.push({
      line,
      column: "paymentTerms",
      message: `"${termsRaw}" is not a payment term. Use one of ${Object.keys(PAYMENT_TERMS_LABELS).join(", ")}.`,
    });
  } else {
    draft.paymentTerms = terms;
  }

  const totalRaw = cell(row, "totalAmount");
  const totalCents = parseAmountToCents(totalRaw, draft.currency);
  if (!totalRaw) {
    draft.errors.push({ line, column: "totalAmount", message: "Total is required." });
  } else if (totalCents === null) {
    draft.errors.push({
      line,
      column: "totalAmount",
      message: `"${totalRaw}" is not an amount.`,
    });
  } else if (totalCents <= 0) {
    draft.errors.push({
      line,
      column: "totalAmount",
      message: "Total must be greater than zero.",
    });
  } else {
    draft.totalCents = totalCents;
  }

  // The due date is DERIVED, never imported — one rule for every channel.
  if (draft.issueDate && draft.paymentTerms) {
    const issue = fromDateInputValue(draft.issueDate);
    if (issue) draft.dueDate = toIsoDate(dueDateFrom(issue, draft.paymentTerms));
  }

  const memo = cell(row, "memo");
  draft.memo = memo === "" ? null : memo;
}

/**
 * A bill's header values are repeated on each of its rows. Disagreeing copies
 * mean the file is wrong about something that matters, so the whole bill is
 * blocked rather than silently taking the first row's word for it.
 */
function assertConsistentHeader(
  draft: ImportBillDraft,
  row: string[],
  line: number,
  cell: CellReader,
): void {
  const checks: { key: ImportColumnKey; actual: string; expected: string | null }[] = [
    {
      key: "totalAmount",
      actual: cell(row, "totalAmount"),
      expected: draft.totalCents === null ? null : String(draft.totalCents),
    },
    {
      key: "issueDate",
      actual: cell(row, "issueDate"),
      expected: draft.issueDate,
    },
    {
      key: "paymentTerms",
      actual: cell(row, "paymentTerms"),
      expected: draft.paymentTerms,
    },
  ];

  for (const check of checks) {
    if (!check.actual || check.expected === null) continue;

    const normalized =
      check.key === "totalAmount"
        ? String(parseAmountToCents(check.actual, draft.currency) ?? "")
        : check.key === "issueDate"
          ? (normalizeDateString(check.actual) ?? "")
          : (asPaymentTerms(check.actual) ?? "");

    if (normalized !== check.expected) {
      draft.errors.push({
        line,
        column: check.key,
        message: `Row disagrees with the first row of ${draft.billNumber || "this bill"} on ${importColumn(check.key).header}. Every row of a bill must repeat the same header values.`,
      });
    }
  }
}

function applyLine(
  draft: ImportBillDraft,
  row: string[],
  line: number,
  cell: CellReader,
  glByCode: Map<string, { id: string; code: string; name: string }>,
): void {
  const description = cell(row, "lineDescription");
  const quantityRaw = cell(row, "lineQuantity");
  const unitPriceRaw = cell(row, "lineUnitPrice");
  const glCode = cell(row, "lineGlCode");
  const department = cell(row, "lineDepartment");

  if (!description && !unitPriceRaw && !glCode) {
    // A row with a bill header but no line content: the file's author probably
    // meant a header-only row. Report it rather than creating an empty line.
    draft.errors.push({
      line,
      column: "lineDescription",
      message: "Row has no line item. Every row must describe one line of the bill.",
    });
    return;
  }

  if (!description) {
    draft.errors.push({
      line,
      column: "lineDescription",
      message: "Line description is required.",
    });
  }

  let quantity = 1;
  if (quantityRaw) {
    const parsed = Number(quantityRaw.replace(/[\s,]/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      draft.errors.push({
        line,
        column: "lineQuantity",
        message: `"${quantityRaw}" is not a positive quantity.`,
      });
    } else {
      if (!Number.isInteger(parsed)) {
        draft.warnings.push({
          line,
          column: "lineQuantity",
          message: `Quantity ${quantityRaw} was rounded to ${Math.round(parsed)} — quantities are whole numbers.`,
        });
      }
      quantity = Math.round(parsed);
    }
  }

  const unitPriceCents = parseAmountToCents(unitPriceRaw, draft.currency);
  if (!unitPriceRaw) {
    draft.errors.push({
      line,
      column: "lineUnitPrice",
      message: "Line unit price is required.",
    });
  } else if (unitPriceCents === null) {
    draft.errors.push({
      line,
      column: "lineUnitPrice",
      message: `"${unitPriceRaw}" is not an amount.`,
    });
  }

  let glAccountId: string | null = null;
  let resolvedCode: string | null = null;
  if (glCode) {
    const account = glByCode.get(glCode.toLowerCase());
    if (!account) {
      draft.errors.push({
        line,
        column: "lineGlCode",
        message: `Unknown GL account "${glCode}". Codes are never guessed — fix the file or add the account.`,
      });
    } else {
      glAccountId = account.id;
      resolvedCode = account.code;
    }
  }

  draft.lines.push({
    line,
    description: description || "(no description)",
    quantity,
    unitPriceCents: unitPriceCents ?? 0,
    amountCents: lineAmountCents(quantity, unitPriceCents ?? 0),
    glAccountId,
    glCode: resolvedCode,
    department: department === "" ? null : department,
  });
}

/** Locale-free "1,234.56" for messages built in pure code. */
function formatPlain(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const major = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const minor = String(absolute % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${major}.${minor}`;
}

// ---------------------------------------------------------------------------
// Result of an actual run
// ---------------------------------------------------------------------------

export interface ImportOutcome {
  billNumber: string;
  vendorName: string;
  status: "CREATED" | "SKIPPED" | "FAILED";
  /** Set on CREATED, so the summary can link straight to the draft. */
  billId?: string;
  reasons: string[];
  sourceLines: number[];
}

export interface ImportSummary {
  created: number;
  skipped: number;
  failed: number;
  outcomes: ImportOutcome[];
}

// ---------------------------------------------------------------------------
// Server-action state
//
// Both import actions are `useActionState` reducers; their state is a plain
// serialisable union so the wizard can render preview and result without
// knowing anything about the server.
// ---------------------------------------------------------------------------

export type ImportPreviewState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: ImportPreview; fileName: string; csvText: string };

export type ImportRunState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; summary: ImportSummary };
