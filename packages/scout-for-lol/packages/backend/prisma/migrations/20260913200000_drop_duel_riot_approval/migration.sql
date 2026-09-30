-- Duels no longer gate on recorded approval rows: the flag is the whole gate.
-- No code path ever wrote this table (it only had a count() reader), so it is
-- empty in every environment; the DO block proves that rather than assuming it.
DO $$
BEGIN
  IF (SELECT count(*) FROM "DuelRiotApproval") > 0 THEN
    RAISE EXCEPTION 'DuelRiotApproval unexpectedly has rows; refusing to drop';
  END IF;
END
$$;

DROP TABLE "DuelRiotApproval";
