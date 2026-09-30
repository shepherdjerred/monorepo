-- Items a failed trade took but could not put anywhere safe (a sell whose
-- refund the ledger refused, or a sell still settling at shutdown). Staff hand
-- them out from here: held_item is a chest shop's serialized item fingerprint
-- or a catalog item key. Both NULL when no items are held.
ALTER TABLE shops_refund_failure ADD COLUMN held_item TEXT;
ALTER TABLE shops_refund_failure ADD COLUMN held_quantity INTEGER CHECK (held_quantity > 0);
