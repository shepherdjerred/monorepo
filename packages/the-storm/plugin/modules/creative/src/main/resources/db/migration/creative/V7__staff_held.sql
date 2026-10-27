-- A plot moved by staff keeps staff on the destination even when that cell is still in the
-- historical catalog. released still hides the row.

ALTER TABLE creative_claims ADD COLUMN staff_held BOOLEAN NOT NULL DEFAULT 0;
