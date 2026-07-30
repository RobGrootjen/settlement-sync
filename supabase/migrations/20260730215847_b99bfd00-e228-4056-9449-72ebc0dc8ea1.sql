DROP INDEX IF EXISTS public.uq_settlement_dedupe;
CREATE UNIQUE INDEX uq_settlement_dedupe ON public.settlement_records
  (processor, processor_transaction_id, merchant_reference, settlement_date, gross_amount_minor)
  NULLS NOT DISTINCT;