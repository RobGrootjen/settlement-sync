ALTER TABLE public.discrepancies ADD COLUMN IF NOT EXISTS fingerprint TEXT;

UPDATE public.discrepancies
SET fingerprint = discrepancy_type
  || ':' || coalesce(transaction_id::text, '-')
  || ':' || coalesce(settlement_record_id::text, '-')
WHERE fingerprint IS NULL;

DELETE FROM public.discrepancies d
USING public.discrepancies k
WHERE d.fingerprint = k.fingerprint
  AND d.ctid > k.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_discrepancy_fingerprint
  ON public.discrepancies (fingerprint);