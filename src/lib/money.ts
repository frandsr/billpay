/**
 * Money helpers.
 *
 * RULE: money is ALWAYS an integer number of minor units ("cents"). Floats are
 * never used for amounts anywhere in the app — not in the DB, not in state, not
 * in form values. Convert at the edges with the helpers below.
 */

/** ISO-4217 codes we know how to render. Currency lives on the Bill. */
export type CurrencyCode = "USD" | "EUR" | "GBP" | "CAD" | "MXN";

/** Minor units per major unit. Kept as a table so zero-decimal currencies
 *  (JPY, CLP, …) can be added without touching call sites. */
const MINOR_UNITS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  MXN: 2,
  JPY: 0,
};

export function minorUnitDigits(currency = "USD"): number {
  return MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

export interface FormatCentsOptions {
  /** ISO-4217 code. Defaults to USD. */
  currency?: string;
  /** Render the currency symbol/code. Default true. */
  showSymbol?: boolean;
  /** Drop the decimals (e.g. "$1,234" instead of "$1,234.00"). Default false. */
  compact?: boolean;
  /** BCP-47 locale. Default "en-US" so output is deterministic in SSR. */
  locale?: string;
}

/**
 * Format an integer cent amount for display.
 *
 * formatCents(123456)                  // "$1,234.56"
 * formatCents(123456, { compact: true }) // "$1,235"
 * formatCents(-500)                    // "-$5.00"
 */
export function formatCents(
  cents: number,
  options: FormatCentsOptions = {},
): string {
  const {
    currency = "USD",
    showSymbol = true,
    compact = false,
    locale = "en-US",
  } = options;

  const digits = minorUnitDigits(currency);
  const value = cents / 10 ** digits;
  const fractionDigits = compact ? 0 : digits;

  if (!showSymbol) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * Parse user input into integer cents. Tolerates "$", thousand separators,
 * whitespace and a leading "-" / parenthesised negatives.
 *
 * Returns `null` when the input is not a usable amount, so callers can decide
 * between "leave the field alone" and "show a validation error".
 *
 * parseAmountToCents("$1,234.56") // 123456
 * parseAmountToCents("(12.50)")   // -1250
 * parseAmountToCents("abc")       // null
 */
export function parseAmountToCents(
  input: string | number | null | undefined,
  currency = "USD",
): number | null {
  if (input === null || input === undefined) return null;

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 10 ** minorUnitDigits(currency));
  }

  let raw = input.trim();
  if (raw === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1);
  }

  // Strip everything except digits, separators and sign.
  raw = raw.replace(/[^\d.,-]/g, "");
  if (raw.startsWith("-")) {
    negative = true;
    raw = raw.slice(1);
  }
  raw = raw.replace(/-/g, "");

  // Treat the LAST separator as the decimal point when it is followed by 1-2
  // digits; otherwise every separator is a thousands separator.
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  const lastSep = Math.max(lastComma, lastDot);
  let integerPart = raw;
  let fractionPart = "";

  if (lastSep !== -1) {
    const tail = raw.slice(lastSep + 1);
    if (/^\d{1,2}$/.test(tail)) {
      integerPart = raw.slice(0, lastSep);
      fractionPart = tail;
    }
  }

  integerPart = integerPart.replace(/[.,]/g, "");
  if (integerPart === "" && fractionPart === "") return null;
  if (!/^\d*$/.test(integerPart) || !/^\d*$/.test(fractionPart)) return null;

  const digits = minorUnitDigits(currency);
  const paddedFraction = fractionPart.padEnd(digits, "0").slice(0, digits);
  const cents =
    Number(integerPart || "0") * 10 ** digits + Number(paddedFraction || "0");

  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Sum integer cent amounts. Safe on empty arrays (returns 0). */
export function sumCents(amounts: Array<number | null | undefined>): number {
  return amounts.reduce<number>(
    (total, amount) => total + (amount ?? 0),
    0,
  );
}

/** quantity * unitPriceCents, rounded to the nearest cent. */
export function lineAmountCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

/** Convenience for building an amount from major units in seeds/tests. */
export function dollars(amount: number): number {
  return Math.round(amount * 100);
}
