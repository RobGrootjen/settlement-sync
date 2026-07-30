ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS dataset_id text;
ALTER TABLE public.settlement_records ADD COLUMN IF NOT EXISTS dataset_id text;
ALTER TABLE public.discrepancies ADD COLUMN IF NOT EXISTS dataset_id text;
ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS dataset_id text;
ALTER TABLE public.reconciliation_events ADD COLUMN IF NOT EXISTS dataset_id text;

CREATE INDEX IF NOT EXISTS idx_transactions_dataset_id ON public.transactions (dataset_id) WHERE dataset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settlement_records_dataset_id ON public.settlement_records (dataset_id) WHERE dataset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_discrepancies_dataset_id ON public.discrepancies (dataset_id) WHERE dataset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_dataset_id ON public.ingestion_runs (dataset_id) WHERE dataset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reconciliation_events_dataset_id ON public.reconciliation_events (dataset_id) WHERE dataset_id IS NOT NULL;