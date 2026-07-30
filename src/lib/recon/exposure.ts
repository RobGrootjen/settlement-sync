/**
 * Pure monetary-exposure rules for OPEN discrepancies.
 *
 * Exposure is the amount of money the finding puts at risk:
 *  - MISSING                    -> abs(expected amount)   (money never received)
 *  - AMOUNT_VARIANCE / FEE_VARIANCE -> abs(variance)      (money over/under settled)
 *  - ORPHANED / AMBIGUOUS       -> abs(actual amount)     (money we cannot attribute)
 */
export interface ExposureInput {
  discrepancy_type: string;
  currency: string | null;
  resolution_status: string;
  expected_amount_minor: number | string | null;
  actual_amount_minor: number | string | null;
  variance_amount_minor: number | string | null;
  processor?: string | null;
}

export interface ExposureBucket {
  key: string;
  currency: string;
  exposure_minor: number;
  count: number;
}

export interface OpenExposure {
  byCurrency: Array<{ currency: string; exposure_minor: number; count: number }>;
  byType: Array<{ type: string; currency: string; exposure_minor: number; count: number }>;
  byProcessor: Array<{ processor: string; currency: string; exposure_minor: number; count: number }>;
}

const num = (v: number | string | null | undefined) => Math.abs(Number(v ?? 0)) || 0;

export function exposureMinor(d: ExposureInput): number {
  switch (d.discrepancy_type) {
    case "MISSING":
      return num(d.expected_amount_minor);
    case "AMOUNT_VARIANCE":
    case "FEE_VARIANCE":
      return num(d.variance_amount_minor);
    case "ORPHANED":
    case "AMBIGUOUS":
      return num(d.actual_amount_minor);
    default:
      return 0;
  }
}

function accumulate(map: Map<string, ExposureBucket>, key: string, currency: string, amount: number) {
  const id = `${key}|${currency}`;
  const entry = map.get(id) ?? { key, currency, exposure_minor: 0, count: 0 };
  entry.exposure_minor += amount;
  entry.count += 1;
  map.set(id, entry);
}

/** Aggregate OPEN discrepancies into currency / type / processor exposure buckets. */
export function summarizeExposure(rows: ExposureInput[]): OpenExposure {
  const byCurrency = new Map<string, ExposureBucket>();
  const byType = new Map<string, ExposureBucket>();
  const byProcessor = new Map<string, ExposureBucket>();

  for (const row of rows) {
    if (row.resolution_status !== "OPEN") continue;
    const currency = row.currency ?? "UNKNOWN";
    const amount = exposureMinor(row);
    accumulate(byCurrency, currency, currency, amount);
    accumulate(byType, row.discrepancy_type, currency, amount);
    accumulate(byProcessor, row.processor ?? "UNKNOWN", currency, amount);
  }

  const sort = (a: ExposureBucket, b: ExposureBucket) => b.exposure_minor - a.exposure_minor;
  return {
    byCurrency: [...byCurrency.values()]
      .sort(sort)
      .map((b) => ({ currency: b.currency, exposure_minor: b.exposure_minor, count: b.count })),
    byType: [...byType.values()]
      .sort(sort)
      .map((b) => ({ type: b.key, currency: b.currency, exposure_minor: b.exposure_minor, count: b.count })),
    byProcessor: [...byProcessor.values()]
      .sort(sort)
      .map((b) => ({ processor: b.key, currency: b.currency, exposure_minor: b.exposure_minor, count: b.count })),
  };
}
