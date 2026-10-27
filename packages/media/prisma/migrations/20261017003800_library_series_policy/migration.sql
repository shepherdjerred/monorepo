-- The existing owner-selected series record is an explicit policy source.
-- Episode-only approvals retain their literal v1 birth and guard.
ALTER TABLE "MediaIntent" ADD COLUMN "libraryMonitoring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AcquisitionAttempt" DROP CONSTRAINT managed_attempt_sponsor;
ALTER TABLE "AcquisitionAttempt" ADD CONSTRAINT managed_attempt_sponsor CHECK (
  "sponsorRequestId" IS NOT NULL OR COALESCE(
    ("identityEvidence"->>'schemaVersion'='3'
      AND "identityEvidence"->'management'="movieEditionAuthority"
      AND "movieEditionAuthority"->>'kind'='library_management'
      AND "movieEditionAuthority"->>'schemaVersion'='2'
      AND "movieEditionChoiceId" IS NULL AND "movieEditionChoiceRevision" IS NULL)
    OR ("identityEvidence"->>'schemaVersion'='4'
      AND "identityEvidence"#>>'{management,kind}'='library_series_management'
      AND ("identityEvidence"#>>'{management,schemaVersion}'='1'
        OR ("identityEvidence"#>>'{management,schemaVersion}'='2'
          AND "identityEvidence"#>>'{management,policyScope}'='series'))
      AND edition='default' AND "movieEditionChoiceId" IS NULL
      AND "movieEditionChoiceRevision" IS NULL AND "movieEditionAuthority" IS NULL), false)
);

DROP TRIGGER library_episode_acquisition ON "AcquisitionAttempt";
CREATE TRIGGER library_episode_acquisition BEFORE INSERT ON "AcquisitionAttempt" FOR EACH ROW
  WHEN (NEW."identityEvidence"->>'schemaVersion'='4' AND NEW."identityEvidence"#>>'{management,schemaVersion}'='1')
  EXECUTE FUNCTION media_library_episode_acquisition();

CREATE FUNCTION media_library_series_acquisition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; approval "MediaHandoffReceipt"; association "PlexAssociationEvidence";
  series "MediaItem"; root_target "MediaIntent"; selected JSONB; captured JSONB; leaf "MediaItem"; target "MediaIntent"; previous_id TEXT := '';
BEGIN
  PERFORM media_plex_assert_deadline();
  proof := NEW."identityEvidence"->'management';
  SELECT * INTO STRICT approval FROM "MediaHandoffReceipt" WHERE id=proof->>'receiptId';
  SELECT * INTO STRICT series FROM "MediaItem" WHERE id=proof->>'seriesId';
  SELECT * INTO STRICT root_target FROM "MediaIntent" WHERE "mediaId"=series.id AND edition='default';
  SELECT item INTO STRICT selected FROM jsonb_array_elements(approval.selection#>'{scope,media}') item WHERE item->>'mediaId'=series.id;
  SELECT * INTO STRICT association FROM "PlexAssociationEvidence" WHERE id=proof#>>'{association,evidenceId}';
  IF NOT COALESCE(NEW."sponsorRequestId" IS NULL AND NEW.edition='default'
    AND NEW."movieEditionChoiceId" IS NULL AND NEW."movieEditionChoiceRevision" IS NULL AND NEW."movieEditionAuthority" IS NULL
    AND proof->>'schemaVersion'='2' AND proof->>'kind'='library_series_management' AND proof->>'policyScope'='series'
    AND series.kind='series' AND series."catalogState"='ready'
    AND NEW."identityEvidence"#>>'{canonical,kind}'='series' AND NEW."identityEvidence"#>>'{canonical,coordinates,seriesId}'=series.id
    AND proof->'birthEpoch'=to_jsonb(NEW."recoveryEpoch") AND NEW."identityEvidence"->'birthEpoch'=to_jsonb(NEW."recoveryEpoch")
    AND approval."recoveryEpoch"=NEW."recoveryEpoch" AND approval."planId"=proof->>'planId' AND approval."planHash"=proof->>'planHash' AND approval."actorId"=proof->>'actorId'
    AND EXISTS (SELECT 1 FROM "MediaHandoffPlan" p WHERE p.id=approval."planId" AND p.state='applied' AND p."planHash"=approval."planHash")
    AND approval.selection#>'{scope,targets}' @> jsonb_build_array(jsonb_build_object('mediaId',series.id,'edition','default'))
    AND approval.selection#>'{scope,request,seriesMonitoring}' @> jsonb_build_array(jsonb_build_object('schemaVersion',1,'seriesId',series.id,'includeFutureEpisodes',true,'includeSpecials',proof->'includeSpecials'))
    AND selected->'monitored'='true'::jsonb AND selected->>'profileId'=proof->>'profileId'
    AND EXISTS (SELECT 1 FROM "MediaUser" u WHERE u.id=approval."actorId" AND u.role='owner' AND NOT u.restricted)
    AND EXISTS (SELECT 1 FROM "QualityProfile" p WHERE p.id=proof->>'profileId' AND to_jsonb(p.version)=proof->'profileVersionAtCapture')
    AND NEW.failure->>'profileId'=proof->>'profileId' AND NEW.failure->'profileVersion'=proof->'profileVersionAtCapture'
    AND cardinality(NEW."mediaIds") BETWEEN 1 AND 100
    AND NEW."identityEvidence"->'coverage'=to_jsonb(NEW."mediaIds")
    AND jsonb_array_length(proof->'targets')=cardinality(NEW."mediaIds")
    AND proof->'rootGenerationAtCapture'=to_jsonb(root_target.generation) AND root_target.generation>0
    AND root_target."desiredPresence" AND root_target.monitoring AND root_target."libraryMonitoring" AND root_target."intentionallyRemovedAt" IS NULL
    AND root_target."automationEpoch"=NEW."recoveryEpoch" AND root_target."profileId"=proof->>'profileId' AND root_target."editionRootId"=series.id
    AND proof->>'selectionHash' ~ '^[a-f0-9]{64}$'
    AND association."associationHash"=proof#>>'{association,associationHash}' AND association."serverMachineId"=proof->>'serverMachineId'
    AND association.evidence->>'kind'='episode' AND association.evidence->>'editionRootId'=series.id
    AND association.evidence#>>'{access,sectionId}'=proof->>'sectionId'
    AND association.evidence#>'{hierarchy,show,guids}' @> jsonb_build_array('tmdb://' || series."tmdbId"::text)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(approval.selection#>'{scope,files}') f WHERE f->>'libraryKind'='tv' AND f->>'assetId'=association."assetId" AND f->'mediaIds' @> to_jsonb(association."mediaId"))
    AND NEW."identityEvidence"#>>'{source,releaseId}'=NEW."releaseId"
    AND EXISTS (SELECT 1 FROM "ReleaseCandidate" r WHERE r.id=NEW."releaseId" AND r."sourceEvidence" IS NOT NULL AND r."encryptedSource" IS NOT NULL), false)
  THEN RAISE EXCEPTION 'Managed series acquisition requires an actual approved series policy'; END IF;
  FOR captured IN SELECT value FROM jsonb_array_elements(proof->'targets') LOOP
    IF captured->>'mediaId' <= previous_id THEN RAISE EXCEPTION 'Managed episode coverage must be distinct and sorted'; END IF;
    previous_id := captured->>'mediaId';
    SELECT * INTO STRICT leaf FROM "MediaItem" WHERE id=previous_id;
    SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=leaf.id AND edition='default';
    IF NOT COALESCE(leaf.id=ANY(NEW."mediaIds") AND leaf.kind='episode' AND leaf."catalogState"='ready'
      AND leaf."seasonNumber" IS NOT NULL AND leaf."episodeNumber" IS NOT NULL
      AND (leaf."seasonNumber"<>0 OR proof->'includeSpecials'='true'::jsonb)
      AND (leaf."parentId"=series.id OR EXISTS (SELECT 1 FROM "MediaItem" season WHERE season.id=leaf."parentId" AND season.kind='season' AND season."parentId"=series.id))
      AND target."profileId"=proof->>'profileId' AND target."desiredPresence" AND target.monitoring AND target."libraryMonitoring" AND target."intentionallyRemovedAt" IS NULL
      AND target."editionRootId"=series.id AND target."automationEpoch"=NEW."recoveryEpoch"
      AND to_jsonb(target.generation)=captured->'generation' AND NEW.generations->leaf.id=captured->'generation'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."identityEvidence"#>'{canonical,coordinates,episodes}') e WHERE e->>'mediaId'=leaf.id),false)
    THEN RAISE EXCEPTION 'Managed series acquisition lost exact current episode policy'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER library_series_acquisition BEFORE INSERT ON "AcquisitionAttempt" FOR EACH ROW
  WHEN (NEW."identityEvidence"->>'schemaVersion'='4' AND NEW."identityEvidence"#>>'{management,schemaVersion}'='2')
  EXECUTE FUNCTION media_library_series_acquisition();
