import { parseMajorToMinor } from "../money";
import { parseProcessorDate } from "../dates";
import type { NormalizedSettlement, ParseResult, RowError } from "../types";
import { nonEmptyLines, splitCsvLine, validateSettlement, type ProcessorAdapter } from "./adapter";

/**
 * NUSAPAY (Indonesia, IDR) — flat CSV, amounts in MAJOR units, header row required.
 * batch_id,txn_ref,merchant_ref,currency,gross,fee,net,settled_on
 */
export const nusapayAdapter: ProcessorAdapter = {
  code: "NUSAPAY",
  label: "NusaPay (Indonesia)",
  format: "CSV — batch_id,txn_ref,merchant_ref,currency,gross,fee,net,settled_on (major units, YYYY-MM-DD)",

  parse(content: string, filename: string): ParseResult {
    const lines = nonEmptyLines(content);
    const accepted: NormalizedSettlement[] = [];
    const rejected: RowError[] = [];
    if (lines.length === 0) return { accepted, rejected, recordCount: 0 };

    const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    const required = ["txn_ref", "currency", "gross", "fee", "settled_on"];
    const missing = required.filter((r) => idx(r) === -1);
    if (missing.length) {
      return {
        accepted,
        rejected: [{ row: 1, reason: `missing header column(s): ${missing.join(", ")}` }],
        recordCount: 0,
      };
    }

    const rows = lines.slice(1);
    rows.forEach((line, i) => {
      const rowNumber = i + 2;
      const cells = splitCsvLine(line);
      const get = (name: string) => (idx(name) === -1 ? "" : (cells[idx(name)] ?? ""));
      const raw = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""]));
      try {
        const currency = get("currency").toUpperCase();
        const gross = parseMajorToMinor(get("gross"), currency as never);
        const fee = parseMajorToMinor(get("fee"), currency as never);
        const netCell = get("net");
        const net = netCell ? parseMajorToMinor(netCell, currency as never) : gross - fee;
        const candidate: NormalizedSettlement = {
          processor: nusapayAdapter.code,
          batch_id: get("batch_id") || null,
          processor_transaction_id: get("txn_ref") || null,
          merchant_reference: get("merchant_ref") || null,
          currency: currency as never,
          gross_amount_minor: gross,
          fee_amount_minor: fee,
          net_amount_minor: net,
          settlement_date: parseProcessorDate(get("settled_on")),
          source_filename: filename,
          raw_payload: raw,
        };
        const error = validateSettlement(candidate, rowNumber);
        if (error) rejected.push(error);
        else accepted.push(candidate);
      } catch (e) {
        rejected.push({ row: rowNumber, reason: (e as Error).message, raw });
      }
    });

    return { accepted, rejected, recordCount: rows.length };
  },
};