import { parseMajorToMinor } from "../money";
import { parseProcessorDate } from "../dates";
import type { NormalizedSettlement, ParseResult, RowError } from "../types";
import { validateSettlement, type ProcessorAdapter } from "./adapter";

/**
 * SIAMLINK (Thailand, THB) — nested JSON batch, amounts in MAJOR units with 2dp.
 * { batch: { id, settled_at }, items: [{ reference, order_id, amount, fee, currency }] }
 */
export const siamlinkAdapter: ProcessorAdapter = {
  code: "SIAMLINK",
  label: "SiamLink (Thailand)",
  format: "JSON — { batch: { id, settled_at }, items: [{ reference, order_id, amount, fee, currency }] }",

  parse(content: string, filename: string): ParseResult {
    const accepted: NormalizedSettlement[] = [];
    const rejected: RowError[] = [];

    let doc: {
      batch?: { id?: string; settled_at?: string };
      items?: Array<Record<string, unknown>>;
    };
    try {
      doc = JSON.parse(content);
    } catch (e) {
      return { accepted, rejected: [{ row: 0, reason: `invalid JSON: ${(e as Error).message}` }], recordCount: 0 };
    }

    const items = Array.isArray(doc.items) ? doc.items : [];
    if (items.length === 0) {
      return { accepted, rejected: [{ row: 0, reason: "no items[] in batch" }], recordCount: 0 };
    }

    items.forEach((item, i) => {
      const rowNumber = i + 1;
      try {
        const currency = String(item.currency ?? "THB").toUpperCase();
        const gross = parseMajorToMinor(String(item.amount ?? ""), currency as never);
        const fee = parseMajorToMinor(String(item.fee ?? "0"), currency as never);
        const settledAt = String(item.settled_at ?? doc.batch?.settled_at ?? "");
        const candidate: NormalizedSettlement = {
          processor: siamlinkAdapter.code,
          batch_id: doc.batch?.id ?? null,
          processor_transaction_id: item.reference ? String(item.reference) : null,
          merchant_reference: item.order_id ? String(item.order_id) : null,
          currency: currency as never,
          gross_amount_minor: gross,
          fee_amount_minor: fee,
          net_amount_minor: gross - fee,
          settlement_date: parseProcessorDate(settledAt),
          source_filename: filename,
          raw_payload: item as Record<string, unknown>,
        };
        const error = validateSettlement(candidate, rowNumber);
        if (error) rejected.push(error);
        else accepted.push(candidate);
      } catch (e) {
        rejected.push({ row: rowNumber, reason: (e as Error).message, raw: JSON.stringify(item) });
      }
    });

    return { accepted, rejected, recordCount: items.length };
  },
};