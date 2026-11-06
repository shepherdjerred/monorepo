-- Staff-custody historical shops trade finite chest stock through the server account.
-- Existing admin shops retain their unlimited-stock behavior, including signs on chests.
ALTER TABLE shops_shop ADD COLUMN admin_stocked INTEGER NOT NULL DEFAULT 0
    CHECK (admin_stocked IN (0, 1)
        AND (admin_stocked = 0 OR (owner_kind = 'admin' AND container_x IS NOT NULL)));
