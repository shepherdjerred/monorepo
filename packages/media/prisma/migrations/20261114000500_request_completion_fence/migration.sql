-- Historical watch booleans remain truthful; NULL counters/windows carry no
-- fresh completion authority. Initial/imported requests retain their old policy.
ALTER TABLE "MediaRequest" ADD COLUMN "completionRequiredAfter" TIMESTAMP(3);
ALTER TABLE "PlexWatchProjection"
  ADD COLUMN "viewCount" INTEGER,
  ADD COLUMN "completionPreviousObservedAt" TIMESTAMP(3),
  ADD COLUMN "completionObservedAt" TIMESTAMP(3);
ALTER TABLE "MediaRequest" ADD CONSTRAINT "request_completion_fence_order"
  CHECK ("completionRequiredAfter" IS NULL OR "completionRequiredAfter" <= "interestRenewedAt");
ALTER TABLE "PlexWatchProjection" ADD CONSTRAINT "plex_completion_window_shape" CHECK (COALESCE(
  ("viewCount" IS NULL OR "viewCount" >= 0)
  AND (("completionPreviousObservedAt" IS NULL AND "completionObservedAt" IS NULL)
    OR ("completionPreviousObservedAt" IS NOT NULL AND "completionObservedAt" IS NOT NULL
      AND "viewCount" > 0 AND watched
      AND "completionPreviousObservedAt" <= "completionObservedAt"
      AND "completionObservedAt" <= "observedAt"))
,false));

-- This is a derivation guard, not a remote-attestation substitute: the existing
-- authorized native watcher supplies each measured counter under its deadline.
CREATE FUNCTION media_native_completion_window_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fence "WatchObservationFence"; previous_time TIMESTAMP(3); completed_time TIMESTAMP(3);
BEGIN
  IF NEW."viewCount" IS NOT NULL THEN
    PERFORM media_plex_assert_deadline();
    IF NEW.watched IS DISTINCT FROM (NEW."viewCount" > 0) THEN
      RAISE EXCEPTION 'Native counter differs from its same-response watch value';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."viewCount" IS NOT NULL AND NEW."viewCount" IS NOT NULL
    AND NEW.watched AND NEW."viewCount" >= OLD."viewCount"
    AND (NEW."userId",NEW."mediaId",NEW.edition,NEW."evidenceId",NEW."associationHash",NEW."bindingRevision",NEW.purpose,NEW.source,NEW."authorityHash",NEW.authority)
      IS NOT DISTINCT FROM
      (OLD."userId",OLD."mediaId",OLD.edition,OLD."evidenceId",OLD."associationHash",OLD."bindingRevision",OLD.purpose,OLD.source,OLD."authorityHash",OLD.authority)
    AND OLD."observedAt" <= NEW."observedAt" AND OLD."observedAt" >= clock_timestamp() - INTERVAL '15 minutes'
    AND NEW."observedAt" <= clock_timestamp()
    AND EXISTS (SELECT 1 FROM "WatchState" w WHERE w."userId"=OLD."userId" AND w."mediaId"=OLD."mediaId" AND w.edition=OLD.edition
      AND w.source='plex_current' AND w.watched=OLD.watched AND w."observedAt"=OLD."observedAt") THEN
    SELECT * INTO STRICT fence FROM "WatchObservationFence"
      WHERE "mediaId"=NEW."mediaId" AND edition=NEW.edition;
    IF OLD."watchBatchRevision"=fence."settledRevision" AND NEW."watchBatchRevision"=fence."issuedRevision"
      AND NEW."watchBatchRevision">OLD."watchBatchRevision" THEN
      IF NEW."viewCount">OLD."viewCount" THEN
        previous_time:=OLD."observedAt"; completed_time:=NEW."observedAt";
      ELSE
        previous_time:=OLD."completionPreviousObservedAt"; completed_time:=OLD."completionObservedAt";
      END IF;
    END IF;
  END IF;
  IF (NEW."completionPreviousObservedAt",NEW."completionObservedAt")
    IS DISTINCT FROM (previous_time,completed_time) THEN
    RAISE EXCEPTION 'Native completion requires consecutive settled same-binding counter observations';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER native_completion_window_v1 BEFORE INSERT OR UPDATE ON "PlexWatchProjection"
FOR EACH ROW EXECUTE FUNCTION media_native_completion_window_v1();

-- Every actual watch-truth invalidator also withdraws its derived counter and
-- completion proof, including profile remaps and recovery declarations.
CREATE FUNCTION media_clear_native_watch_projection_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "PlexWatchProjection" WHERE "userId"=OLD."userId" AND "mediaId"=OLD."mediaId" AND edition=OLD.edition;
  RETURN OLD;
END;
$$;
CREATE TRIGGER clear_native_watch_projection_v1 AFTER DELETE ON "WatchState"
FOR EACH ROW EXECUTE FUNCTION media_clear_native_watch_projection_v1();
