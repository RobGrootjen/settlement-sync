import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface CurrencyBucket {
  currency: string;
  processor: string;
  captured_minor: number;
  settled_gross_minor: number;
  settled_net_minor: number;
  fee_minor: number;
  counts: Record<string, number>;
}

export interface ReconciliationReport {
  buckets: CurrencyBucket[];
  totals: {
    transactions: number;
    settlements: number;
    matchedSettlements: number;
    openDiscrepancies: number;
  };
  statusCounts: Record<string, number>;
  discrepancyCounts: Array<{ type: string; severity: string; count: number }>;
}

export async function getReconciliationReport(): Promise<ReconciliationReport> {
  const [{ data: txns }, { data: settlements }, { data: discrepancies }] = await Promise.all([
    supabaseAdmin.from("transactions").select("processor,currency,captured_amount_minor,reconciliation_status"),
    supabaseAdmin
      .from("settlement_records")
      .select("processor,currency,gross_amount_minor,fee_amount_minor,net_amount_minor,matched_transaction_id"),
    supabaseAdmin.from("discrepancies").select("discrepancy_type,severity,resolution_status"),
  ]);

  const bucketMap = new Map<string, CurrencyBucket>();
  const bucket = (processor: string, currency: string) => {
    const key = `${processor}|${currency}`;
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        processor,
        currency,
        captured_minor: 0,
        settled_gross_minor: 0,
        settled_net_minor: 0,
        fee_minor: 0,
        counts: {},
      });
    }
    return bucketMap.get(key)!;
  };

  const statusCounts: Record<string, number> = {};
  for (const t of txns ?? []) {
    const b = bucket(t.processor, t.currency);
    b.captured_minor += Number(t.captured_amount_minor ?? 0);
    b.counts[t.reconciliation_status] = (b.counts[t.reconciliation_status] ?? 0) + 1;
    statusCounts[t.reconciliation_status] = (statusCounts[t.reconciliation_status] ?? 0) + 1;
  }

  let matchedSettlements = 0;
  for (const s of settlements ?? []) {
    const b = bucket(s.processor, s.currency);
    b.settled_gross_minor += Number(s.gross_amount_minor);
    b.settled_net_minor += Number(s.net_amount_minor);
    b.fee_minor += Number(s.fee_amount_minor);
    if (s.matched_transaction_id) matchedSettlements++;
  }

  const counterMap = new Map<string, { type: string; severity: string; count: number }>();
  let openDiscrepancies = 0;
  for (const d of discrepancies ?? []) {
    if (d.resolution_status === "OPEN") openDiscrepancies++;
    const key = `${d.discrepancy_type}|${d.severity}`;
    const entry = counterMap.get(key) ?? { type: d.discrepancy_type, severity: d.severity, count: 0 };
    entry.count++;
    counterMap.set(key, entry);
  }

  return {
    buckets: [...bucketMap.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    totals: {
      transactions: txns?.length ?? 0,
      settlements: settlements?.length ?? 0,
      matchedSettlements,
      openDiscrepancies,
    },
    statusCounts,
    discrepancyCounts: [...counterMap.values()].sort((a, b) => b.count - a.count),
  };
}

export interface DiscrepancyFilters {
  type?: string;
  severity?: string;
  currency?: string;
  status?: string;
  limit?: number;
}

export async function listDiscrepancies(filters: DiscrepancyFilters = {}) {
  let query = supabaseAdmin
    .from("discrepancies")
    .select(
      "*, transactions(transaction_id,processor,payment_method), settlement_records(processor,processor_transaction_id,batch_id,source_filename)",
    )
    .order("severity", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.type) query = query.eq("discrepancy_type", filters.type);
  if (filters.severity) query = query.eq("severity", filters.severity);
  if (filters.currency) query = query.eq("currency", filters.currency);
  if (filters.status) query = query.eq("resolution_status", filters.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listIngestionRuns(limit = 25) {
  const { data, error } = await supabaseAdmin
    .from("ingestion_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listEvents(limit = 50) {
  const { data, error } = await supabaseAdmin
    .from("reconciliation_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function resolveDiscrepancy(input: { id: string; status: "RESOLVED" | "IGNORED"; note?: string }) {
  const { error } = await supabaseAdmin
    .from("discrepancies")
    .update({ resolution_status: input.status, resolved_at: new Date().toISOString() })
    .eq("id", input.id);
  if (error) throw new Error(error.message);

  await supabaseAdmin.from("reconciliation_events").insert({
    transaction_id: null,
    settlement_record_id: null,
    event_type: `DISCREPANCY_${input.status}`,
    details: { discrepancy_id: input.id, note: input.note ?? null } as never,
  });
  return { ok: true };
}