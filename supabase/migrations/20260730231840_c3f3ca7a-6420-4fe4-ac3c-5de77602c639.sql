-- Financial reconciliation data must not be readable via the public Data API.
-- All application reads go through trusted server-side code (service role),
-- so removing these permissive policies does not affect app functionality.
DROP POLICY IF EXISTS "public read transactions" ON public.transactions;
DROP POLICY IF EXISTS "public read settlement_records" ON public.settlement_records;
DROP POLICY IF EXISTS "public read discrepancies" ON public.discrepancies;
DROP POLICY IF EXISTS "public read reconciliation_events" ON public.reconciliation_events;
DROP POLICY IF EXISTS "public read ingestion_runs" ON public.ingestion_runs;
DROP POLICY IF EXISTS "public read processor_fee_rules" ON public.processor_fee_rules;

-- Belt and braces: ensure no Data API privileges are granted to public roles.
REVOKE ALL ON public.transactions FROM anon, authenticated;
REVOKE ALL ON public.settlement_records FROM anon, authenticated;
REVOKE ALL ON public.discrepancies FROM anon, authenticated;
REVOKE ALL ON public.reconciliation_events FROM anon, authenticated;
REVOKE ALL ON public.ingestion_runs FROM anon, authenticated;
REVOKE ALL ON public.processor_fee_rules FROM anon, authenticated;

-- Server-side/privileged access remains.
GRANT ALL ON public.transactions TO service_role;
GRANT ALL ON public.settlement_records TO service_role;
GRANT ALL ON public.discrepancies TO service_role;
GRANT ALL ON public.reconciliation_events TO service_role;
GRANT ALL ON public.ingestion_runs TO service_role;
GRANT ALL ON public.processor_fee_rules TO service_role;

-- RLS stays enabled; with no SELECT policy, direct public reads are denied.
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processor_fee_rules ENABLE ROW LEVEL SECURITY;