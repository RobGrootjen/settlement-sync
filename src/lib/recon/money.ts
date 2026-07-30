import type { Currency } from "./types";

/**
 * Currency scale = number of decimal places in the *major* unit.
 * IDR and VND are zero-decimal in practice; THB has two.
 * Getting this wrong inflates or deflates amounts by 100x, so it is explicit.
 */
export const CURRENCY_SCALE: Record<Currency, number> = {
  IDR: 0,
  THB: 2,
  VND: 0,
};

export function isCurrency(value: unknown): value is Currency {
  return value === "IDR" || value === "THB" || value === "VND";
}

/**
 * Parse a decimal string in MAJOR units into integer MINOR units.
 * Pure string math: no parseFloat, no floating point rounding surprises.
 * Accepts "1,234.56", "1234", "-12.5", " 1 234,00 " is NOT accepted (ambiguous).
 */
export function parseMajorToMinor(input: string | number, currency: Currency): number {
  const scale = CURRENCY_SCALE[currency];
  const raw = String(input).trim().replace(/,/g, "");
  if (raw === "" || !/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid amount "${input}" for ${currency}`);
  }
  const negative = raw.startsWith("-");
  const [intPart, fracPartRaw = ""] = raw.replace("-", "").split(".");
  if (fracPartRaw.length > scale) {
    // More precision than the currency supports -> reject rather than silently round.
    const extra = fracPartRaw.slice(scale).replace(/0+$/, "");
    if (extra.length > 0) {
      throw new Error(
        `Amount "${input}" has more precision than ${currency} supports (${scale} dp)`,
      );
    }
  }
  const frac = fracPartRaw.padEnd(scale, "0").slice(0, scale);
  const minor = Number(`${intPart}${frac}`);
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of safe range: ${input}`);
  return negative ? -minor : minor;
}

/** Parse a value that is ALREADY in minor units. */
export function parseMinor(input: string | number): number {
  const raw = String(input).trim().replace(/,/g, "");
  if (!/^-?\d+$/.test(raw)) throw new Error(`Invalid minor-unit amount "${input}"`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`Amount out of safe range: ${input}`);
  return value;
}

/** Format minor units back to a human string. Display only. */
export function formatMinor(minor: number, currency: string): string {
  const scale = isCurrency(currency) ? CURRENCY_SCALE[currency] : 2;
  const negative = minor < 0;
  const digits = Math.abs(minor).toString().padStart(scale + 1, "0");
  const intPart = digits.slice(0, digits.length - scale) || "0";
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${frac} ${currency}`;
}

/**
 * Expected fee = round(gross * bps / 10000) + fixed, computed in integer space.
 * Half-up rounding, applied to the absolute value so sign is symmetric.
 */
export function expectedFeeMinor(
  grossMinor: number,
  feeBps: number,
  fixedFeeMinor: number,
): number {
  const sign = grossMinor < 0 ? -1 : 1;
  const abs = Math.abs(grossMinor);
  const variable = Math.floor((abs * feeBps + 5000) / 10000);
  return sign * (variable + fixedFeeMinor);
}