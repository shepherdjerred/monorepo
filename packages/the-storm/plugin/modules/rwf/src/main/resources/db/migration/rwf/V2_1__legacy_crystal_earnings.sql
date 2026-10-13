-- V2 was already published, so its checksum must remain unchanged. Restore the
-- legacy cap's accounting table with a forward migration. PayoutService rebuilds
-- its totals from dated economy receipts before settling legacy crystal rows;
-- unfinished, uncommitted payouts reserve against the current day's budget.
CREATE TABLE rwf_daily_earnings (
  player TEXT NOT NULL,
  day TEXT NOT NULL,
  credits BIGINT NOT NULL,
  PRIMARY KEY (player, day)
);
