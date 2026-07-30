import { splitCsvLine, nonEmptyLines } from "./processors/adapter";

export interface TransactionInput {
  transaction_id: string;
  merchant_reference?: string | null;
  processor: string;
  payment_method: string;
  status: string;
  currency: string;
  captured_amount_minor: string | number | null;
  capture_date?: string | null;
}

/** Captures arrive as JSON in API calls and as CSV in the sample dataset. */
export function looksLikeCsv(content: string): boolean {
  const first = content.trimStart()[0];
  return first !== "{" && first !== "[";
}

/**
 * CSV capture parser. Header-driven so column order does not matter.
 * Required: transaction_id, processor, payment_method, status, currency.
 */
export function parseCapturesCsv(content: string): TransactionInput[] {
  const lines = nonEmptyLines(content);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const required = ["transaction_id", "processor", "payment_method", "status", "currency"];
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length) throw new Error(`missing header column(s): ${missing.join(", ")}`);

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const get = (name: string) => {
      const i = header.indexOf(name);
      return i === -1 ? "" : (cells[i] ?? "");
    };
    return {
      transaction_id: get("transaction_id"),
      merchant_reference: get("merchant_reference") || null,
      processor: get("processor"),
      payment_method: get("payment_method"),
      status: get("status"),
      currency: get("currency"),
      captured_amount_minor: get("captured_amount_minor") === "" ? null : get("captured_amount_minor"),
      capture_date: get("capture_date") || null,
    } satisfies TransactionInput;
  });
}
