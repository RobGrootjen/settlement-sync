import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  planReconciliation,
  type ExistingDiscrepancy,
  type MatchUpdate,
  type ReconciliationSummary,
  type SettlementForPlan,
} from "./plan";
import type { FeeRule, ReconciliationStatus, TxnCandidate } from "./types";

export type { ReconciliationSummary } from "./plan";

/**
 * Full reconciliation pass. Idempotent by construction: it computes the
 * desired end state with the pure planner, then writes only the differences.
 * Re-running with unchanged data performs no writes and emits no events.
 */
export async function runReconciliation(
  options: { rematchAll?: boolean } = {},
): Promise<ReconciliationSummary> {
  const now = new Date();

  const [
    { data: txnData, error: txnError },
    { data: settlementData, error: settlementError },
    { data: ruleData },
    { data: discrepancyData, error: discrepancyError },
  ] = await Promise.all([
    supabaseAdmin
      .from("transactions")
      .select(
        "id,transaction_id,merchant_reference,processor,payment_method,status,currency,captured_amount_minor,capture_date,expected_settlement_date,reconciliation_status",
      ),
    supabaseAdmin
      .from("settlement_records")
      .select(
        "id,processor,batch_id,processor_transaction_id,merchant_reference,currency,gross_amount_minor,fee_amount_minor,net_amount_minor,settlement_date,source_filename,matched_transaction_id,match_method,match_confidence",
      )
      .order("settlement_date", { ascending: true }),
    supabaseAdmin.from("processor_fee_rules").select("*"),
    supabaseAdmin
      .from("discrepancies")
      .select(
        "id,fingerprint,discrepancy_type,severity,currency,expected_amount_minor,actual_amount_minor,variance_amount_minor,reason,resolution_status",
      ),
  ]);

  if (txnError) throw new Error(txnError.message);
  if (settlementError) throw new Error(settlementError.message);
  if (discrepancyError) throw new Error(discrepancyError.message);

  const plan = planReconciliation({
    transactions: (txnData ?? []) as unknown as TxnCandidate[],
    settlements: (settlementData ?? []) as unknown as SettlementForPlan[],
    feeRules: (ruleData ?? []) as unknown as FeeRule[],
    existingDiscrepancies: (discrepancyData ?? []) as unknown as ExistingDiscrepancy[],
    now,
    rematchAll: options.rematchAll ?? false,
  });

  await applyMatchUpdates(plan.matchUpdates);
  await applyStatusUpdates(plan.statusUpdates);

  if (plan.discrepancyDeleteIds.length > 0) {
    const { error } = await supabaseAdmin
      .from("discrepancies")
      .delete()
      .in("id", plan.discrepancyDeleteIds);
    if (error) throw new Error(error.message);
  }
  for (const chunk of chunked(plan.discrepancyUpdates, 50)) {
    await Promise.all(
      chunk.map((u) => supabaseAdmin.from("discrepancies").update(u.patch as never).eq("id", u.id)),
    );
  }
  if (plan.discrepancyInserts.length > 0) {
    const { error } = await supabaseAdmin
      .from("discrepancies")
      .upsert(plan.discrepancyInserts as never, { onConflict: "fingerprint" });
    if (error) throw new Error(error.message);
  }
  if (plan.events.length > 0) {
    const { error } = await supabaseAdmin.from("reconciliation_events").insert(plan.events as never);
    if (error) throw new Error(error.message);
  }

  return plan.summary;
}

async function applyMatchUpdates(updates: MatchUpdate[]) {
  for (const chunk of chunked(updates, 50)) {
    await Promise.all(
      chunk.map((u) =>
        supabaseAdmin
          .from("settlement_records")
          .update({
            matched_transaction_id: u.matched_transaction_id,
            match_method: u.match_method,
            match_confidence: u.match_confidence,
          })
          .eq("id", u.id),
      ),
    );
  }
}

async function applyStatusUpdates(updates: Array<{ id: string; status: ReconciliationStatus }>) {
  for (const chunk of chunked(updates, 50)) {
    await Promise.all(
      chunk.map((u) =>
        supabaseAdmin.from("transactions").update({ reconciliation_status: u.status }).eq("id", u.id),
      ),
    );
  }
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
