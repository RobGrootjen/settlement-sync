import { describe, expect, it } from "vitest";
import { exposureMinor, summarizeExposure } from "../exposure";

const base = {
  currency: "IDR",
  resolution_status: "OPEN",
  expected_amount_minor: null,
  actual_amount_minor: null,
  variance_amount_minor: null,
  processor: "NUSAPAY",
};

describe("open discrepancy exposure", () => {
  it("uses the right amount per discrepancy type", () => {
    expect(exposureMinor({ ...base, discrepancy_type: "MISSING", expected_amount_minor: 1000 })).toBe(1000);
    expect(exposureMinor({ ...base, discrepancy_type: "AMOUNT_VARIANCE", variance_amount_minor: -250 })).toBe(250);
    expect(exposureMinor({ ...base, discrepancy_type: "FEE_VARIANCE", variance_amount_minor: 40 })).toBe(40);
    expect(exposureMinor({ ...base, discrepancy_type: "ORPHANED", actual_amount_minor: 900 })).toBe(900);
    expect(exposureMinor({ ...base, discrepancy_type: "AMBIGUOUS", actual_amount_minor: -700 })).toBe(700);
  });

  it("aggregates only OPEN findings by currency, type and processor", () => {
    const summary = summarizeExposure([
      { ...base, discrepancy_type: "MISSING", expected_amount_minor: 1000 },
      { ...base, discrepancy_type: "ORPHANED", actual_amount_minor: 500 },
      {
        ...base,
        discrepancy_type: "MISSING",
        currency: "VND",
        processor: "MEKONGPAY",
        expected_amount_minor: 300,
      },
      {
        ...base,
        discrepancy_type: "MISSING",
        resolution_status: "RESOLVED",
        expected_amount_minor: 99999,
      },
    ]);
    expect(summary.byCurrency).toEqual([
      { currency: "IDR", exposure_minor: 1500, count: 2 },
      { currency: "VND", exposure_minor: 300, count: 1 },
    ]);
    expect(summary.byType).toContainEqual({ type: "MISSING", currency: "IDR", exposure_minor: 1000, count: 1 });
    expect(summary.byProcessor).toContainEqual({
      processor: "MEKONGPAY",
      currency: "VND",
      exposure_minor: 300,
      count: 1,
    });
  });
});
