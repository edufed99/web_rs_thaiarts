-- Drop NOT NULL on artifact_item_id so legacy migration can insert rows
-- (0002 backfills values; we'll re-add NOT NULL only if backfill completes)
ALTER TABLE items ALTER COLUMN artifact_item_id DROP NOT NULL;
SELECT 'items.artifact_item_id is now nullable' AS status;