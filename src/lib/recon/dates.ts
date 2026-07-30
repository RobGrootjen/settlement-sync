import type { PaymentMethod } from "./types";

/** Contractual settlement windows in days, per payment method. */
export const SETTLEMENT_WINDOW_DAYS: Record<PaymentMethod, number> = {
  credit_card: 3,
  bank_transfer: 7,
  e_wallet: 2,
};

/** Extra slack allowed when matching on amount+date (tier 3) only. */
export const MATCH_GRACE_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export function windowDays(method: string): number {
  return SETTLEMENT_WINDOW_DAYS[method as PaymentMethod] ?? 7;
}

export function addDays(iso: string | Date, days: number): Date {
  const base = iso instanceof Date ? iso : new Date(iso);
  return new Date(base.getTime() + days * DAY_MS);
}

/** capture_date + window(payment_method) */
export function expectedSettlementDate(
  captureDate: string | Date,
  paymentMethod: string,
): Date {
  return addDays(captureDate, windowDays(paymentMethod));
}

/**
 * Tier-3 date validity: settlement must land on/after capture and no later than
 * the expected settlement date plus grace.
 */
export function withinMatchWindow(
  captureDate: string | null,
  paymentMethod: string,
  settlementDate: string,
): boolean {
  if (!captureDate) return false;
  const capture = new Date(captureDate).getTime();
  const settle = new Date(settlementDate).getTime();
  if (Number.isNaN(capture) || Number.isNaN(settle)) return false;
  const latest = capture + (windowDays(paymentMethod) + MATCH_GRACE_DAYS) * DAY_MS;
  return settle >= capture - DAY_MS && settle <= latest;
}

/** Parse loose processor date formats into an ISO string. */
export function parseProcessorDate(value: string): string {
  const raw = String(value).trim();
  // YYYYMMDD
  if (/^\d{8}$/.test(raw)) {
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date "${value}"`);
    return d.toISOString();
  }
  // DD/MM/YYYY
  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date "${value}"`);
    return d.toISOString();
  }
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date "${value}"`);
  return d.toISOString();
}