/**
 * Deterministic demo fixtures. Every known discrepancy class is represented:
 * clean match, amount variance, fee variance, missing settlement, orphan,
 * ambiguous pair, plus NOT_DUE (authorized / cancelled) transactions.
 */

const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};
const iso = (n: number) => daysAgo(n).toISOString();
const ymd = (n: number) => iso(n).slice(0, 10);
const compact = (n: number) => ymd(n).replace(/-/g, "");

export const DEMO_TRANSACTIONS = JSON.stringify(
  [
    // NusaPay / IDR
    { transaction_id: "NP-1001", merchant_reference: "MC-IDR-001", processor: "NUSAPAY", payment_method: "credit_card", status: "CAPTURED", currency: "IDR", captured_amount_minor: 250000, capture_date: iso(6) },
    { transaction_id: "NP-1002", merchant_reference: "MC-IDR-002", processor: "NUSAPAY", payment_method: "credit_card", status: "CAPTURED", currency: "IDR", captured_amount_minor: 1750000, capture_date: iso(6) },
    { transaction_id: "NP-1003", merchant_reference: "MC-IDR-003", processor: "NUSAPAY", payment_method: "bank_transfer", status: "CAPTURED", currency: "IDR", captured_amount_minor: 900000, capture_date: iso(20) },
    { transaction_id: "NP-1004", merchant_reference: "MC-IDR-004", processor: "NUSAPAY", payment_method: "e_wallet", status: "AUTHORIZED", currency: "IDR", captured_amount_minor: null, capture_date: null },
    { transaction_id: "NP-1005", merchant_reference: "MC-IDR-005", processor: "NUSAPAY", payment_method: "credit_card", status: "CANCELLED", currency: "IDR", captured_amount_minor: null, capture_date: null },
    // SiamLink / THB
    { transaction_id: "SL-2001", merchant_reference: "MC-THB-001", processor: "SIAMLINK", payment_method: "credit_card", status: "CAPTURED", currency: "THB", captured_amount_minor: 125000, capture_date: iso(4) },
    { transaction_id: "SL-2002", merchant_reference: "MC-THB-002", processor: "SIAMLINK", payment_method: "e_wallet", status: "CAPTURED", currency: "THB", captured_amount_minor: 48000, capture_date: iso(3) },
    { transaction_id: "SL-2003", merchant_reference: null, processor: "SIAMLINK", payment_method: "credit_card", status: "CAPTURED", currency: "THB", captured_amount_minor: 99900, capture_date: iso(2) },
    { transaction_id: "SL-2004", merchant_reference: null, processor: "SIAMLINK", payment_method: "credit_card", status: "CAPTURED", currency: "THB", captured_amount_minor: 99900, capture_date: iso(2) },
    { transaction_id: "SL-2005", merchant_reference: "MC-THB-005", processor: "SIAMLINK", payment_method: "bank_transfer", status: "CAPTURED", currency: "THB", captured_amount_minor: 500000, capture_date: iso(1) },
    // MekongPay / VND
    { transaction_id: "MK-3001", merchant_reference: "MC-VND-001", processor: "MEKONGPAY", payment_method: "credit_card", status: "CAPTURED", currency: "VND", captured_amount_minor: 4500000, capture_date: iso(5) },
    { transaction_id: "MK-3002", merchant_reference: "MC-VND-002", processor: "MEKONGPAY", payment_method: "e_wallet", status: "CAPTURED", currency: "VND", captured_amount_minor: 1200000, capture_date: iso(9) },
    { transaction_id: "MK-3003", merchant_reference: "MC-VND-003", processor: "MEKONGPAY", payment_method: "bank_transfer", status: "CAPTURED", currency: "VND", captured_amount_minor: 8000000, capture_date: iso(1) },
  ],
  null,
  2,
);

/** NusaPay: clean, amount variance (NP-1002 short by 50,000), NP-1003 missing entirely. */
export const DEMO_NUSAPAY_CSV = [
  "batch_id,txn_ref,merchant_ref,currency,gross,fee,net,settled_on",
  `NP-BATCH-77,NP-1001,MC-IDR-001,IDR,250000,207250,42750,${ymd(3)}`,
  `NP-BATCH-77,NP-1002,MC-IDR-002,IDR,1700000,249300,1450700,${ymd(3)}`,
  `NP-BATCH-77,NP-9999,MC-IDR-999,IDR,325000,209425,115575,${ymd(3)}`,
].join("\n");

/** SiamLink: fee variance on SL-2001, ambiguous pair via amount-only rows. */
export const DEMO_SIAMLINK_JSON = JSON.stringify(
  {
    batch: { id: "SL-BATCH-1204", settled_at: ymd(1) },
    items: [
      { reference: "SL-2001", order_id: "MC-THB-001", currency: "THB", amount: "1250.00", fee: "95.00" },
      { reference: "SL-2002", order_id: "MC-THB-002", currency: "THB", amount: "480.00", fee: "10.64" },
      { reference: "SL-UNKNOWN-1", order_id: null, currency: "THB", amount: "999.00", fee: "30.47" },
    ],
  },
  null,
  2,
);

/** MekongPay: clean match, plus an orphan settlement with no capture. */
export const DEMO_MEKONGPAY_TXT = [
  `H|MK-BATCH-0091|${compact(1)}`,
  `D|MK-3001|MC-VND-001|VND|4500000|4362000|${compact(1)}`,
  `D|MK-3002|MC-VND-002|VND|1200000|1176800|${compact(6)}`,
  `D|MK-8888|MC-VND-888|VND|2750000|2665500|${compact(1)}`,
  "T|3",
].join("\n");

export const DEMO_FILES = [
  { processor: "CAPTURES", filename: "captures.json", content: DEMO_TRANSACTIONS },
  { processor: "NUSAPAY", filename: "nusapay_settlement.csv", content: DEMO_NUSAPAY_CSV },
  { processor: "SIAMLINK", filename: "siamlink_batch.json", content: DEMO_SIAMLINK_JSON },
  { processor: "MEKONGPAY", filename: "mekongpay_settlement.txt", content: DEMO_MEKONGPAY_TXT },
];