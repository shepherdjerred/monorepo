-- Separate, immutable acknowledgements for the explicit movie v4 installation protocol.
-- Existing caption operations and their literal results retain their formats.
CREATE FUNCTION media_movie_subtitle_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; envelope JSONB; subtitle "SubtitleAsset"; asset "LibraryAsset"; publication "MediaPublicationTransition";
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'movieSubtitleReceiptV4' THEN RAISE EXCEPTION 'Committed movie subtitle receipt is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'movieSubtitleReceiptV4' THEN
    IF NEW.result->'movieSubtitleReceiptV4' IS DISTINCT FROM OLD.result->'movieSubtitleReceiptV4'
      OR (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload) IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
    THEN RAISE EXCEPTION 'Committed movie subtitle receipt or command is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'movieSubtitleReceiptV4') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  envelope := NEW.result->'movieSubtitleReceiptV4'; proof := envelope->'receipt';
  SELECT * INTO STRICT subtitle FROM "SubtitleAsset" WHERE id=proof #>> '{input,subtitleId}';
  SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=subtitle."assetId";
  SELECT * INTO STRICT publication FROM "MediaPublicationTransition" WHERE id=proof #>> '{publication,transitionId}';
  IF NOT COALESCE(envelope->>'receiptHash' ~ '^[a-f0-9]{64}$' AND proof->'schemaVersion'='4'::jsonb
    AND NEW.kind='acquire_movie_subtitles_v4' AND NEW."targetId"=asset.id
    AND proof #> '{input,schemaVersion}'='4'::jsonb AND proof #>> '{input,operationId}'=NEW.id
    AND proof #>> '{input,assetId}'=asset.id AND proof #> '{input,scope}'=NEW.payload->'scope'
    AND NEW.payload @> (proof->'target') AND proof #>> '{target,operationId}'=NEW.id
    AND proof #>> '{command,kind}'=NEW.kind AND proof #>> '{command,targetId}'=asset.id
    AND proof #>> '{input,scope,rootMediaId}'=asset."editionRootId" AND proof #>> '{input,scope,mediaId}'=asset."editionRootId"
    AND proof #>> '{input,scope,edition}'=asset.edition,false)
  THEN RAISE EXCEPTION 'Movie subtitle receipt command or edition scope changed'; END IF;
  IF NOT COALESCE(asset.owned AND asset.state='published'
    AND EXISTS (SELECT 1 FROM "MediaItem" WHERE id=asset."editionRootId" AND kind='movie')
    AND (SELECT count(*)=1 FROM "AssetCoverage" WHERE "assetId"=asset.id AND current)
    AND EXISTS (SELECT 1 FROM "AssetCoverage" WHERE "assetId"=asset.id AND "mediaId"=asset."editionRootId" AND edition=asset.edition AND current)
    AND proof->>'videoPath'=asset.path AND proof #>> '{publication,assetId}'=asset.id AND proof #> '{publication,assetVersion}'=to_jsonb(asset.version)
    AND publication.intent->'schemaVersion'='2'::jsonb AND publication.intent->'scope'=NEW.payload->'scope'
    AND publication.outcome->>'kind'='published' AND publication.outcome #>> '{entries,0,successor,id}'=asset.id
    AND publication.outcome #>> '{entries,0,successor,checksum}'=asset.checksum
    AND proof #>> '{publication,intentHash}'=publication."intentHash" AND proof #>> '{publication,outcomeHash}'=publication."outcomeHash",false)
  THEN RAISE EXCEPTION 'Movie subtitle receipt physical publication changed'; END IF;
  IF NOT COALESCE(subtitle.state='installed' AND subtitle.version=1 AND subtitle."qualityStatus"='accepted' AND subtitle."storageKind"='sidecar'
    AND subtitle."ownershipEpoch"=asset."ownershipEpoch" AND subtitle."videoChecksum"=asset.checksum AND subtitle."videoVersion"=asset.version
    AND subtitle."ownershipEpoch"=(NEW.payload->>'recoveryEpoch')::integer
    AND subtitle.checksum=encode(sha256(subtitle.content),'hex') AND subtitle.checksum=proof #>> '{after,checksum}'
    AND proof #>> '{after,id}'=subtitle.id AND proof #> '{after,version}'=to_jsonb(subtitle.version)
    AND proof #>> '{after,path}'=subtitle.path AND proof #> '{after,matchingEvidence}'=subtitle."matchingEvidence"
    AND proof #> '{after,provenance}'=subtitle.provenance AND proof #>> '{after,contentChecksum}'=subtitle.checksum
    AND proof #>> '{journal,operationId}'=NEW.id AND proof #>> '{journal,phase}'='complete'
    AND proof #>> '{journal,target}'=subtitle.path AND proof #>> '{journal,sha256}'=subtitle.checksum
    AND subtitle."matchingEvidence" #>> '{movieInstallationV4,operationId}'=NEW.id,false)
  THEN RAISE EXCEPTION 'Movie subtitle receipt caption or journal changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s.id=subtitle.id AND s.xmin::text=(txid_current() % 4294967296)::text)
  THEN RAISE EXCEPTION 'Movie subtitle receipt requires a same-transaction installation'; END IF;
  IF NOT COALESCE((proof->>'committedAt')::timestamptz <= clock_timestamp()
    AND (proof->>'committedAt')::timestamptz >= (proof->>'observedAt')::timestamptz
    AND (proof->>'expiresAt')::timestamptz <= (proof->>'observedAt')::timestamptz + interval '60 seconds'
    AND (proof->>'expiresAt')::timestamptz <= (proof->>'sdkExpiresAt')::timestamptz
    AND EXTRACT(EPOCH FROM (proof->>'expiresAt')::timestamptz)*1000 <= NULLIF(current_setting('media.plex_deadline_ms',true),'')::numeric
    AND (proof->>'committedAt')::timestamptz < (proof->>'expiresAt')::timestamptz,false)
  THEN RAISE EXCEPTION 'Movie subtitle receipt original deadline changed'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_subtitle_receipt BEFORE INSERT OR UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_movie_subtitle_receipt();
