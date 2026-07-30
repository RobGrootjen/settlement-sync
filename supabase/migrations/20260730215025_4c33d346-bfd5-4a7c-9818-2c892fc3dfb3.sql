-- =========================================================
-- Settlement reconciliation core schema
-- Money is ALWAYS stored in integer minor units (bigint).
-- =========================================================

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT UNIQUE NOT NULL,
  merchant_reference TEXT,
  processor TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('credit_card','bank_transfer','e_wallet')),
  status TEXT NOT NULL CHECK (status IN ('AUTHORIZED','CAPTURED','CANCELLED')),
  currency TEXT NOT NULL CHECK (currency IN ('IDR','THB','VND')),
  captured_amount_minor BIGINT CHECK (captured_amount_minor IS NULL OR captured_amount_minor >= 0),
  capture_date TIMESTAMPTZ,
  expected_settlement_date TIMESTAMPTZ,
  reconciliation_status TEXT NOT NULL DEFAULT 'NOT_DUE'
    CHECK (reconciliation_status IN ('NOT_DUE','PENDING','SETTLED','OVERDUE','VARIANCE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_processor_status ON public.transactions (processor, status);
CREATE INDEX idx_transactions_recon_status ON public.transactions (reconciliation_status);
CREATE INDEX idx_transactions_tier3 ON public.transactions (processor, currency, captured_amount_minor);
CREATE INDEX idx_transactions_merchant_ref ON public.transactions (processor, merchant_reference);
CREATE INDEX idx_transactions_expected_settlement ON public.transactions (expected_settlement_date);

CREATE TABLE public.settlement_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processor TEXT NOT NULL,
  batch_id TEXT,
  processor_transaction_id TEXT,
  merchant_reference TEXT,
  currency TEXT NOT NULL,
  gross_amount_minor BIGINT NOT NULL,
  fee_amount_minor BIGINT NOT NULL,
  net_amount_minor BIGINT NOT NULL,
  settlement_date TIMESTAMPTZ NOT NULL,
  source_filename TEXT,
  raw_payload JSONB,
  matched_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  match_method TEXT CHECK (match_method IS NULL OR match_method IN ('EXACT_TXN_ID','EXACT_MERCHANT_REF','AMOUNT_DATE_WINDOW')),
  match_confidence NUMERIC(3,2) CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ingestion idempotency key
CREATE UNIQUE INDEX uq_settlement_dedupe ON public.settlement_records
  (processor, coalesce(processor_transaction_id,''), coalesce(merchant_reference,''), settlement_date, gross_amount_minor);
CREATE INDEX idx_settlement_processor_txn ON public.settlement_records (processor, processor_transaction_id);
CREATE INDEX idx_settlement_processor_ref ON public.settlement_records (processor, merchant_reference);
CREATE INDEX idx_settlement_matched ON public.settlement_records (matched_transaction_id);
CREATE INDEX idx_settlement_batch ON public.settlement_records (batch_id);
CREATE INDEX idx_settlement_date ON public.settlement_records (settlement_date);
CREATE INDEX idx_settlement_tier3 ON public.settlement_records (processor, currency, gross_amount_minor);

CREATE TABLE public.discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  settlement_record_id UUID REFERENCES public.settlement_records(id) ON DELETE CASCADE,
  discrepancy_type TEXT NOT NULL
    CHECK (discrepancy_type IN ('MISSING','AMOUNT_VARIANCE','FEE_VARIANCE','ORPHANED','AMBIGUOUS')),
  severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  currency TEXT,
  expected_amount_minor BIGINT,
  actual_amount_minor BIGINT,
  variance_amount_minor BIGINT,
  reason TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (resolution_status IN ('OPEN','RESOLVED','IGNORED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Prevents duplicate open findings when reconciliation is re-run
CREATE UNIQUE INDEX uq_discrepancy_open ON public.discrepancies
  (discrepancy_type, coalesce(transaction_id,'00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(settlement_record_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX idx_discrepancies_type_status ON public.discrepancies (discrepancy_type, resolution_status);
CREATE INDEX idx_discrepancies_txn ON public.discrepancies (transaction_id);
CREATE INDEX idx_discrepancies_settlement ON public.discrepancies (settlement_record_id);

CREATE TABLE public.ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processor TEXT,
  filename TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ingestion_runs_created ON public.ingestion_runs (created_at DESC);

CREATE TABLE public.reconciliation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  settlement_record_id UUID REFERENCES public.settlement_records(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  match_method TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recon_events_created ON public.reconciliation_events (created_at DESC);
CREATE INDEX idx_recon_events_txn ON public.reconciliation_events (transaction_id);
CREATE INDEX idx_recon_events_settlement ON public.reconciliation_events (settlement_record_id);

-- Expected-fee source of truth: fee = round(gross * bps / 10000) + fixed
CREATE TABLE public.processor_fee_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processor TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  currency TEXT NOT NULL,
  fee_bps INTEGER NOT NULL DEFAULT 0,
  fixed_fee_minor BIGINT NOT NULL DEFAULT 0,
  tolerance_minor BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (processor, payment_method, currency)
);

-- =========================
-- Grants + RLS (no auth: public read-only; all writes are server-side)
-- =========================
GRANT SELECT ON public.transactions TO anon, authenticated;
GRANT SELECT ON public.settlement_records TO anon, authenticated;
GRANT SELECT ON public.discrepancies TO anon, authenticated;
GRANT SELECT ON public.ingestion_runs TO anon, authenticated;
GRANT SELECT ON public.reconciliation_events TO anon, authenticated;
GRANT SELECT ON public.processor_fee_rules TO anon, authenticated;

GRANT ALL ON public.transactions TO service_role;
GRANT ALL ON public.settlement_records TO service_role;
GRANT ALL ON public.discrepancies TO service_role;
GRANT ALL ON public.ingestion_runs TO service_role;
GRANT ALL ON public.reconciliation_events TO service_role;
GRANT ALL ON public.processor_fee_rules TO service_role;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processor_fee_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read transactions" ON public.transactions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read settlement_records" ON public.settlement_records FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read discrepancies" ON public.discrepancies FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read ingestion_runs" ON public.ingestion_runs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read reconciliation_events" ON public.reconciliation_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read processor_fee_rules" ON public.processor_fee_rules FOR SELECT TO anon, authenticated USING (true);

-- Default fee rules
INSERT INTO public.processor_fee_rules (processor, payment_method, currency, fee_bps, fixed_fee_minor, tolerance_minor) VALUES
  ('NUSAPAY','credit_card','IDR',290,200000,0),
  ('NUSAPAY','bank_transfer','IDR',100,400000,0),
  ('NUSAPAY','e_wallet','IDR',150,100000,0),
  ('SIAMLINK','credit_card','THB',275,300,0),
  ('SIAMLINK','bank_transfer','THB',90,1000,0),
  ('SIAMLINK','e_wallet','THB',180,200,0),
  ('MEKONGPAY','credit_card','VND',300,3000,0),
  ('MEKONGPAY','bank_transfer','VND',110,5000,0),
  ('MEKONGPAY','e_wallet','VND',160,2000,0);