import type { NormalizedSettlement, ParseResult, RowError } from "../types";
import { isCurrency } from "../money";

export interface ProcessorAdapter {
  /** Stable processor code stored on every row. */
  code: string;
  label: string;
  /** Human description of the file format, shown in the UI. */
  format: string;
  /** Parse a raw file body into normalized settlements + per-row rejections. */
  parse(content: string, filename: string): ParseResult;
}

/**
 * Shared post-parse validation. Every adapter funnels through this so the
 * invariants (currency, non-negative money, net = gross - fee, valid date)
 * are enforced in exactly one place.
 */
export function validateSettlement(
  candidate: NormalizedSettlement,
  rowIndex: number,
): RowError | null {
  const fail = (reason: string): RowError => ({ row: rowIndex, reason, raw: JSON.stringify(candidate.raw_payload) });

  if (!isCurrency(candidate.currency)) return fail(`Unsupported currency "${candidate.currency}"`);
  if (!Number.isSafeInteger(candidate.gross_amount_minor)) return fail("gross amount is not an integer");
  if (!Number.isSafeInteger(candidate.fee_amount_minor)) return fail("fee amount is not an integer");
  if (candidate.gross_amount_minor <= 0) return fail("gross amount must be positive");
  if (candidate.fee_amount_minor < 0) return fail("fee amount must not be negative");
  if (candidate.net_amount_minor !== candidate.gross_amount_minor - candidate.fee_amount_minor) {
    return fail(
      `net (${candidate.net_amount_minor}) != gross (${candidate.gross_amount_minor}) - fee (${candidate.fee_amount_minor})`,
    );
  }
  if (Number.isNaN(new Date(candidate.settlement_date).getTime())) return fail("invalid settlement date");
  // A row with no identifiers is still usable: tier-3 (amount + currency +
  // date window) exists precisely for anonymous processor rows. It is only
  // rejected when it also lacks the fields tier 3 needs.
  if (!candidate.processor_transaction_id && !candidate.merchant_reference) {
    if (!candidate.gross_amount_minor || !candidate.settlement_date) {
      return fail("row has no identifiers and no amount/date to match on");
    }
  }
  return null;
}

/** Minimal RFC4180-ish CSV splitter (handles quoted fields, no embedded newlines). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function nonEmptyLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}