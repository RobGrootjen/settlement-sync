import { parseMinor } from "../money";
import { parseProcessorDate } from "../dates";
import type { NormalizedSettlement, ParseResult, RowError } from "../types";
import { nonEmptyLines, validateSettlement, type ProcessorAdapter } from "./adapter";

/**
 * MEKONGPAY (Vietnam, VND) — pipe-delimited, no header, amounts already in MINOR
 * units (VND is zero-decimal so minor == major), NET is stated and fee derived.
 * H|batch|YYYYMMDD                       (header line, optional)
 * D|txn_ref|merchant_ref|VND|gross|net|YYYYMMDD
 * T|record_count                          (trailer, optional)
 */
export const mekongpayAdapter: ProcessorAdapter = {
  code: "MEKONGPAY",
  label: "MekongPay (Vietnam)",
  format: "Pipe-delimited — D|txn_ref|merchant_ref|VND|gross|net|YYYYMMDD (minor units)",

  parse(content: string, filename: string): ParseResult {
    const accepted: NormalizedSettlement[] = [];
    const rejected: RowError[] = [];
    const lines = nonEmptyLines(content);

    let batchId: string | null = null;
    let dataRows = 0;

    lines.forEach((line, i) => {
      const rowNumber = i + 1;
      const cells = line.split("|").map((c) => c.trim());
      const kind = cells[0]?.toUpperCase();

      if (kind === "H") {
        batchId = cells[1] || null;
        return;
      }
      if (kind === "T") return;
      if (kind !== "D") {
        rejected.push({ row: rowNumber, reason: `unknown record type "${cells[0]}"`, raw: line });
        return;
      }

      dataRows++;
      try {
        const [, txnRef, merchantRef, currency, gross, net, settledOn] = cells;
        const grossMinor = parseMinor(gross);
        const netMinor = parseMinor(net);
        const candidate: NormalizedSettlement = {
          processor: mekongpayAdapter.code,
          batch_id: batchId,
          processor_transaction_id: txnRef || null,
          merchant_reference: merchantRef || null,
          currency: (currency || "VND").toUpperCase() as never,
          gross_amount_minor: grossMinor,
          fee_amount_minor: grossMinor - netMinor,
          net_amount_minor: netMinor,
          settlement_date: parseProcessorDate(settledOn ?? ""),
          source_filename: filename,
          raw_payload: { line, cells },
        };
        const error = validateSettlement(candidate, rowNumber);
        if (error) rejected.push(error);
        else accepted.push(candidate);
      } catch (e) {
        rejected.push({ row: rowNumber, reason: (e as Error).message, raw: line });
      }
    });

    return { accepted, rejected, recordCount: dataRows };
  },
};