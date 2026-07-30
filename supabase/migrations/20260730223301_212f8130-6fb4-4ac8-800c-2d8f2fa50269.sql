DELETE FROM public.reconciliation_events e
WHERE e.dataset_id IS NULL AND (
  EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = e.transaction_id AND t.transaction_id LIKE 'DMO-%')
  OR EXISTS (SELECT 1 FROM public.settlement_records s WHERE s.id = e.settlement_record_id AND (s.processor_transaction_id LIKE 'DMO-%' OR s.batch_id LIKE 'DMO-%'))
);

DELETE FROM public.discrepancies d
WHERE d.dataset_id IS NULL AND (
  EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = d.transaction_id AND t.transaction_id LIKE 'DMO-%')
  OR EXISTS (SELECT 1 FROM public.settlement_records s WHERE s.id = d.settlement_record_id AND (s.processor_transaction_id LIKE 'DMO-%' OR s.batch_id LIKE 'DMO-%'))
);

DELETE FROM public.settlement_records
WHERE dataset_id IS NULL AND (processor_transaction_id LIKE 'DMO-%' OR batch_id LIKE 'DMO-%');

DELETE FROM public.transactions
WHERE dataset_id IS NULL AND transaction_id LIKE 'DMO-%';

DELETE FROM public.ingestion_runs
WHERE dataset_id IS NULL
  AND filename IN ('transactions.csv','nusapay-settlements.csv','siamlink-settlements.json','mekongpay-settlements.txt','captures.json','nusapay_settlement.csv','siamlink_batch.json','mekongpay_settlement.txt');