-- Candidate-only speech measurement is one bounded stage before physical installation.
-- Existing automatic-upgrade parents are intentionally unchanged: their birth follows preparation.
CREATE FUNCTION media_subtitle_prepared_proof_v1(p_evidence jsonb,p_video text,p_caption text,p_regular boolean) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE speech jsonb; timing jsonb; part jsonb; runtime_ms numeric; speech_ms numeric; covered_ms numeric;
  total_speech numeric:=0; total_covered numeric:=0; part_speech numeric; part_covered numeric; require_regular boolean;
BEGIN
  IF NOT COALESCE(jsonb_typeof(p_evidence)='object' AND p_video ~ '^[a-f0-9]{64}$' AND p_caption ~ '^[a-f0-9]{64}$',false) THEN RETURN false; END IF;
  speech:=p_evidence->'regularDialogueV1'; timing:=p_evidence->'timingAlignedV1';
  IF NOT COALESCE(jsonb_typeof(speech)='object' AND jsonb_typeof(timing)='object'
    AND (NOT p_evidence ? 'regularDialogueRequiredV1' OR p_evidence->'regularDialogueRequiredV1' IN ('true'::jsonb,'false'::jsonb)),false)
  THEN RETURN false; END IF;
  IF NOT COALESCE((SELECT count(*) FROM jsonb_object_keys(speech))=8
    AND speech ?& ARRAY['schemaVersion','detector','videoChecksum','subtitleChecksum','runtimeMs','speechMs','coveredSpeechMs','windows']
    AND speech->'schemaVersion'='1'::jsonb AND speech->>'detector'='ffsubsync-0.5.1/webrtc'
    AND speech->>'videoChecksum'=p_video AND speech->>'subtitleChecksum'=p_caption
    AND jsonb_typeof(speech->'runtimeMs')='number' AND jsonb_typeof(speech->'speechMs')='number'
    AND jsonb_typeof(speech->'coveredSpeechMs')='number' AND jsonb_typeof(speech->'windows')='array'
    AND timing=jsonb_build_object('schemaVersion',1,'videoChecksum',p_video,'subtitleChecksum',p_caption,
      'engine','ffsubsync-0.5.1','maxOffsetSeconds',60,'goldenSectionRequested',true,'fixFrameRate',false),false)
  THEN RETURN false; END IF;
  IF jsonb_array_length(speech->'windows')<>12 THEN RETURN false; END IF;
  runtime_ms:=(speech->>'runtimeMs')::numeric; speech_ms:=(speech->>'speechMs')::numeric; covered_ms:=(speech->>'coveredSpeechMs')::numeric;
  IF runtime_ms<>trunc(runtime_ms) OR speech_ms<>trunc(speech_ms) OR covered_ms<>trunc(covered_ms)
    OR runtime_ms NOT BETWEEN 1 AND 28800000 OR speech_ms<=0 OR speech_ms>runtime_ms OR covered_ms<0 OR covered_ms>speech_ms
  THEN RETURN false; END IF;
  require_regular:=p_regular OR p_evidence->'regularDialogueRequiredV1'='true'::jsonb;
  IF COALESCE(require_regular,false) AND (speech_ms<least(30000,runtime_ms/4) OR covered_ms*10<speech_ms*9) THEN RETURN false; END IF;
  FOR part IN SELECT value FROM jsonb_array_elements(speech->'windows') LOOP
    IF NOT COALESCE(jsonb_typeof(part)='object',false) THEN RETURN false; END IF;
    IF NOT COALESCE((SELECT count(*) FROM jsonb_object_keys(part))=2 AND part ?& ARRAY['speechMs','coveredSpeechMs']
      AND jsonb_typeof(part->'speechMs')='number' AND jsonb_typeof(part->'coveredSpeechMs')='number',false) THEN RETURN false; END IF;
    part_speech:=(part->>'speechMs')::numeric; part_covered:=(part->>'coveredSpeechMs')::numeric;
    IF part_speech<>trunc(part_speech) OR part_covered<>trunc(part_covered)
      OR part_speech<0 OR part_covered<0 OR part_covered>part_speech
      OR (COALESCE(require_regular,false) AND part_speech>=1000 AND part_covered*10<part_speech*7)
    THEN RETURN false; END IF;
    total_speech:=total_speech+part_speech; total_covered:=total_covered+part_covered;
  END LOOP;
  RETURN total_speech=speech_ms AND total_covered=covered_ms;
END;
$$;

CREATE FUNCTION media_movie_subtitle_installation_version_v1(p_proof jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE before_caption jsonb:=p_proof->'before'; after_caption jsonb:=p_proof->'after'; evidence jsonb; expected jsonb;
BEGIN
  IF before_caption->'version'='0'::jsonb AND after_caption->'version'='1'::jsonb THEN RETURN true; END IF;
  evidence:=before_caption->'matchingEvidence';
  expected:=evidence||jsonb_build_object('schemaVersion',4,'movieScope',p_proof#>'{input,scope}',
    'targetAuthority',p_proof#>'{target,targetAuthority}','target',
    (p_proof->'target')-ARRAY['schemaVersion','operationId','scope','assetId','recoveryEpoch','targetAuthority','upgradeV1'],
    'movieInstallationV4',jsonb_build_object('schemaVersion',4,'operationId',p_proof#>>'{input,operationId}'));
  RETURN COALESCE(before_caption->'version'='1'::jsonb AND after_caption->'version'='2'::jsonb
    AND before_caption->>'state'='validated' AND before_caption->'path'='null'::jsonb
    AND before_caption->>'storageKind'='sidecar' AND before_caption->>'qualityStatus'='accepted'
    AND (before_caption-ARRAY['version','state','path','provenance','matchingEvidence'])=(after_caption-ARRAY['version','state','path','provenance','matchingEvidence'])
    AND after_caption->'matchingEvidence'=expected
    AND after_caption->'provenance'=(before_caption->'provenance')||jsonb_build_object('checksum',after_caption->>'checksum')
    AND evidence->'schemaVersion'='4'::jsonb AND evidence->>'operationId'=p_proof#>>'{input,operationId}'
    AND evidence->'movieScope'=p_proof#>'{input,scope}' AND evidence->'targetAuthority'=p_proof#>'{target,targetAuthority}'
    AND evidence->'assetVersion'=before_caption->'videoVersion' AND evidence->'assetChecksum'=before_caption->'videoChecksum'
    AND evidence->'recoveryEpoch'=before_caption->'ownershipEpoch'
    AND media_subtitle_prepared_proof_v1(evidence,before_caption->>'videoChecksum',before_caption->>'checksum',
      p_proof#>'{target,forced}'='false'::jsonb AND before_caption->'forced'='null'::jsonb),false);
END;
$$;

-- Preserve every existing command, physical parent, journal, transaction and deadline guard.
CREATE OR REPLACE FUNCTION media_movie_subtitle_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; envelope JSONB; subtitle "SubtitleAsset"; asset "LibraryAsset";
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
    AND media_movie_subtitle_parent(proof->'publication',asset,NEW.payload->'scope'),false)
  THEN RAISE EXCEPTION 'Movie subtitle receipt physical publication changed'; END IF;
  IF NOT COALESCE(subtitle.state='installed' AND media_movie_subtitle_installation_version_v1(proof) AND subtitle."qualityStatus"='accepted' AND subtitle."storageKind"='sidecar'
    AND subtitle."ownershipEpoch"=asset."ownershipEpoch" AND subtitle."videoChecksum"=asset.checksum AND subtitle."videoVersion"=asset.version
    AND subtitle."ownershipEpoch"=(NEW.payload->>'recoveryEpoch')::integer
    AND (NOT NEW.payload ? 'forced' OR COALESCE(to_jsonb(subtitle.forced),'null'::jsonb)=NEW.payload->'forced'
      OR (NEW.payload->'forced'='false'::jsonb AND subtitle.forced IS NULL AND subtitle.language IN ('en','zh-CN','zh-Hans')
        AND media_subtitle_regular_dialogue_v1(subtitle)))
    AND (NEW.payload->>'hearingImpaired' IS DISTINCT FROM 'required' OR subtitle."hearingImpaired" IS TRUE)
    AND (NEW.payload->>'hearingImpaired' IS DISTINCT FROM 'excluded' OR subtitle."hearingImpaired" IS FALSE)
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
