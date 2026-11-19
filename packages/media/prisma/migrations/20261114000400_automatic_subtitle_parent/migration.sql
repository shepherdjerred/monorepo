-- Automatic improvements have a distinct operation/event parent. Manual upload
-- and human approval facts keep their original meaning and remain immutable.
CREATE FUNCTION media_subtitle_score_valid_v1(p_score jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE weights jsonb; expected integer; total integer;
BEGIN
  IF NOT COALESCE(jsonb_typeof(p_score)='object' AND p_score->>'weights'='bazarr-1.6.2' AND p_score->>'matcher'='media-evidence-v1'
    AND p_score->'schemaVersion'='1'::jsonb AND jsonb_typeof(p_score->'matches')='array'
    AND p_score->>'referenceHash' ~ '^[a-f0-9]{64}$' AND p_score->>'catalogStatus' IN ('confirmed','unconfirmed'),false) THEN RETURN false; END IF;
  IF p_score->>'kind'='episode' THEN
    expected:=360; weights:='{"series":160,"year":90,"season":30,"episode":30,"source":25,"release_group":20,"audio_codec":1,"resolution":1,"video_codec":1,"hearing_impaired":1,"streaming_service":1}';
  ELSIF p_score->>'kind'='movie' THEN
    expected:=180; weights:='{"title":60,"year":40,"source":30,"edition":30,"release_group":15,"audio_codec":1,"resolution":1,"video_codec":1,"hearing_impaired":1,"streaming_service":1}';
  ELSE RETURN false; END IF;
  IF jsonb_array_length(p_score->'matches')>13 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_score->'matches') k WHERE NOT weights ? k)
    OR (SELECT count(*)<>count(DISTINCT k) FROM jsonb_array_elements_text(p_score->'matches') k) THEN RETURN false; END IF;
  SELECT COALESCE(sum((weights->>k)::integer),0) INTO total FROM jsonb_array_elements_text(p_score->'matches') k;
  RETURN COALESCE(p_score->'maximum'=to_jsonb(expected) AND p_score->'score'=to_jsonb(total),false);
END;
$$;

CREATE FUNCTION media_subtitle_automatic_candidate_valid_v1(p_candidate "SubtitleAsset",p_old "SubtitleAsset",p_asset "LibraryAsset",p_event "ApplicationEvent",p_scope jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE command "Operation"; download "ApplicationEvent"; score jsonb; prior jsonb;
BEGIN
  score:=p_event.payload->'score'; prior:=p_event.payload->'oldScore';
  SELECT o.* INTO command FROM "Operation" o WHERE o.id=p_event.payload->>'operationId';
  SELECT e.* INTO download FROM "ApplicationEvent" e WHERE e.id=command.result#>>'{subtitleDownload,eventId}';
  RETURN COALESCE(p_event.kind='subtitle_automatic_upgrade_candidate_v1'
    AND NOT (p_candidate."matchingEvidence" ? 'movieManualReplacementV2')
    AND p_candidate."matchingEvidence"#>'{automaticSubtitleUpgradeV1,schemaVersion}'='1'::jsonb
    AND p_candidate."matchingEvidence"#>>'{automaticSubtitleUpgradeV1,eventId}'=p_event.id
    AND p_candidate."matchingEvidence"->>'operationId'=command.id AND p_candidate."matchingEvidence"->'matchScoreV1'=score
    AND p_old."matchingEvidence"->'matchScoreV1'=prior AND media_subtitle_score_valid_v1(score) AND media_subtitle_score_valid_v1(prior)
    AND score->>'kind'=prior->>'kind' AND score->>'referenceHash'=prior->>'referenceHash' AND (score->>'score')::integer>(prior->>'score')::integer
    AND (score->>'score')::numeric/(score->>'maximum')::numeric>=CASE WHEN score->>'kind'='episode' THEN 0.70 ELSE 0.80 END
    AND command.kind=CASE WHEN p_scope IS NULL OR p_scope='null'::jsonb THEN 'acquire_subtitles' ELSE 'acquire_movie_subtitles_v4' END
    AND command."targetId"=p_asset.id AND command.payload->>'assetId'=p_asset.id
    AND command.payload->>'targetAuthority'=p_event.payload->>'targetAuthority'
    AND command.payload->>'language'=p_candidate.language
    AND (p_scope IS NULL OR p_scope='null'::jsonb OR command.payload->'scope'=p_scope)
    AND command.payload->'recoveryEpoch'=to_jsonb(p_asset."ownershipEpoch")
    AND command.payload#>>'{upgradeV1,oldSubtitleId}'=p_old.id AND command.payload#>'{upgradeV1,oldVersion}'=to_jsonb(p_old.version)
    AND command.payload#>>'{upgradeV1,oldChecksum}'=p_old.checksum AND command.payload#>'{upgradeV1,minimumScore}'=prior
    AND command.result#>>'{subtitleDownload,providerId}'=p_candidate."providerId" AND length(command.result#>>'{subtitleDownload,candidateId}')>0
    AND download.kind='subtitle_download_requested' AND download.payload->>'operationId'=command.id
    AND download.payload->>'providerId'=command.result#>>'{subtitleDownload,providerId}' AND download.payload->>'candidateId'=command.result#>>'{subtitleDownload,candidateId}'
    AND download.payload->>'requestedAt'=command.result#>>'{subtitleDownload,requestedAt}'
    AND download."createdAt">=command."createdAt" AND download."createdAt"<=p_event."createdAt"
    AND p_candidate."assetId"=p_asset.id AND p_old."assetId"=p_asset.id AND p_old."qualityStatus"='accepted'
    AND p_old.state='installed' AND p_old."storageKind"='sidecar' AND p_old.path IS NOT NULL
    AND p_old."videoChecksum"=p_asset.checksum AND p_old."videoVersion"=p_asset.version AND p_old."ownershipEpoch"=p_asset."ownershipEpoch"
    AND p_old."createdAt">=p_event."createdAt"-interval '7 days' AND p_old."createdAt"<=p_event."createdAt"
    AND p_candidate.state='validated' AND p_candidate.path IS NULL AND p_candidate.checksum<>p_old.checksum
    AND p_candidate."videoChecksum"=p_asset.checksum AND p_candidate."videoVersion"=p_asset.version AND p_candidate."ownershipEpoch"=p_asset."ownershipEpoch"
    AND p_candidate."qualityStatus"='accepted' AND p_candidate."storageKind"='sidecar' AND p_candidate.checksum=encode(sha256(p_candidate.content),'hex')
    AND p_event.payload->>'subtitleId'=p_candidate.id AND p_event.payload->>'oldSubtitleId'=p_old.id
    AND p_event.payload->'oldVersion'=to_jsonb(p_old.version) AND p_event.payload->>'assetId'=p_asset.id AND p_event.payload->>'checksum'=p_candidate.checksum
    AND p_event.payload->'scope'=COALESCE(p_scope,'null'::jsonb)
    AND p_event.payload->>'targetAuthority'=p_candidate."matchingEvidence"->>'targetAuthority'
    AND EXISTS(SELECT 1 FROM "MediaUser" u WHERE u.id=p_event."actorId" AND u.role='owner' AND NOT u.restricted),false);
END;
$$;

CREATE FUNCTION media_subtitle_automatic_authorization_valid_v1(p_replacement "SubtitleReplacement",p_review "SubtitleReplacementReview") RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE event "ApplicationEvent"; candidate_event "ApplicationEvent";
BEGIN
  SELECT e.* INTO event FROM "ApplicationEvent" e WHERE e."dedupeKey"='subtitle-automatic-authorization:'||p_replacement.id;
  SELECT e.* INTO candidate_event FROM "ApplicationEvent" e WHERE e.id=p_replacement.snapshot#>>'{candidate,matchingEvidence,automaticSubtitleUpgradeV1,eventId}';
  RETURN COALESCE(event.kind='subtitle_automatic_upgrade_authorized_v1' AND p_review."approvedById" IS NULL AND p_review."approvedAt" IS NULL
    AND event."actorId"=p_replacement."ownerId" AND event.payload->>'replacementId'=p_replacement.id
    AND event.payload->>'snapshotHash'=p_replacement."snapshotHash" AND event.payload->>'observationHash'=p_review."observationHash"
    AND (event.payload->>'expiresAt')::timestamptz=(p_review."expiresAt" AT TIME ZONE 'UTC')
    AND p_review."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') AND event.payload->>'policy'='bazarr-personal-v1'
    AND event."createdAt">=p_review."createdAt" AND event."createdAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
    AND candidate_event.kind='subtitle_automatic_upgrade_candidate_v1' AND event.payload->>'operationId'=candidate_event.payload->>'operationId'
    AND EXISTS(SELECT 1 FROM "MediaUser" u WHERE u.id=event."actorId" AND u.role='owner' AND NOT u.restricted),false);
END;
$$;

CREATE FUNCTION media_subtitle_automatic_event_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate "SubtitleAsset"; previous_caption "SubtitleAsset"; asset "LibraryAsset"; replacement "SubtitleReplacement"; review "SubtitleReplacementReview"; parent "ApplicationEvent";
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.kind IN ('subtitle_download_requested','subtitle_automatic_upgrade_candidate_v1','subtitle_automatic_upgrade_authorized_v1') THEN
    RAISE EXCEPTION 'Automatic subtitle authority events are immutable';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.kind='subtitle_automatic_upgrade_candidate_v1' THEN
    SELECT s.* INTO STRICT candidate FROM "SubtitleAsset" s WHERE s.id=NEW.payload->>'subtitleId';
    SELECT s.* INTO STRICT previous_caption FROM "SubtitleAsset" s WHERE s.id=NEW.payload->>'oldSubtitleId';
    SELECT a.* INTO STRICT asset FROM "LibraryAsset" a WHERE a.id=candidate."assetId";
    IF NOT media_subtitle_automatic_candidate_valid_v1(candidate,previous_caption,asset,NEW,NEW.payload->'scope') THEN RAISE EXCEPTION 'Automatic subtitle candidate requires its actual download, numerical improvement and video parent'; END IF;
  ELSIF NEW.kind='subtitle_automatic_upgrade_authorized_v1' THEN
    SELECT r.* INTO STRICT replacement FROM "SubtitleReplacement" r WHERE r.id=NEW.payload->>'replacementId';
    SELECT r.* INTO STRICT review FROM "SubtitleReplacementReview" r WHERE r."replacementId"=replacement.id;
    SELECT e.* INTO STRICT parent FROM "ApplicationEvent" e WHERE e.id=replacement.snapshot#>>'{candidate,matchingEvidence,automaticSubtitleUpgradeV1,eventId}';
    IF NOT COALESCE(NEW."actorId"=replacement."ownerId" AND replacement.state='awaiting_review' AND replacement."reservationActive"
      AND NEW."dedupeKey"='subtitle-automatic-authorization:'||replacement.id AND NEW.payload->>'snapshotHash'=replacement."snapshotHash"
      AND NEW.payload->>'observationHash'=review."observationHash" AND (NEW.payload->>'expiresAt')::timestamptz=review."expiresAt" AT TIME ZONE 'UTC'
      AND review."approvedById" IS NULL AND review."approvedAt" IS NULL AND review."expiresAt">clock_timestamp() AT TIME ZONE 'UTC'
      AND parent.kind='subtitle_automatic_upgrade_candidate_v1' AND NEW.payload->>'operationId'=parent.payload->>'operationId'
      AND NEW.payload->>'policy'='bazarr-personal-v1' AND EXISTS(SELECT 1 FROM "MediaUser" u WHERE u.id=NEW."actorId" AND u.role='owner' AND NOT u.restricted),false)
    THEN RAISE EXCEPTION 'Automatic subtitle authorization requires its current observed policy parent'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER subtitle_automatic_event_v1 BEFORE INSERT OR UPDATE OR DELETE ON "ApplicationEvent" FOR EACH ROW EXECUTE FUNCTION media_subtitle_automatic_event_v1();

CREATE FUNCTION media_subtitle_download_checkpoint_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.result ? 'subtitleDownload' AND NEW.result->'subtitleDownload' IS DISTINCT FROM OLD.result->'subtitleDownload' THEN
    RAISE EXCEPTION 'Actual subtitle download checkpoints are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER subtitle_download_checkpoint_v1 BEFORE UPDATE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_subtitle_download_checkpoint_v1();

-- A marker alone never creates authority. Its event is committed atomically,
-- and a later physical transition must belong to this transaction's receipt.
CREATE FUNCTION media_subtitle_automatic_parent_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate "SubtitleAsset"; previous_caption "SubtitleAsset"; asset "LibraryAsset"; event "ApplicationEvent";
BEGIN
  IF NOT (NEW."matchingEvidence" ? 'automaticSubtitleUpgradeV1') THEN RETURN NEW; END IF;
  SELECT s.* INTO STRICT candidate FROM "SubtitleAsset" s WHERE s.id=NEW.id;
  SELECT e.* INTO STRICT event FROM "ApplicationEvent" e WHERE e.id=candidate."matchingEvidence"#>>'{automaticSubtitleUpgradeV1,eventId}';
  IF TG_OP='INSERT' OR NOT (OLD."matchingEvidence" ? 'automaticSubtitleUpgradeV1') THEN
    SELECT s.* INTO STRICT previous_caption FROM "SubtitleAsset" s WHERE s.id=event.payload->>'oldSubtitleId';
    SELECT a.* INTO STRICT asset FROM "LibraryAsset" a WHERE a.id=candidate."assetId";
    IF NOT media_subtitle_automatic_candidate_valid_v1(candidate,previous_caption,asset,event,event.payload->'scope') THEN
      RAISE EXCEPTION 'Automatic subtitle marker requires its actual candidate event';
    END IF;
  -- Guard the replacement birth/swap only. Once installed, the unchanged
  -- native quarantine/archive/restore receipt machinery owns later lifetimes.
  ELSIF OLD.state='validated' AND (NEW.state,NEW.path,NEW.version) IS DISTINCT FROM (OLD.state,OLD.path,OLD.version) THEN
    IF NOT EXISTS(SELECT 1 FROM "SubtitleReplacement" r JOIN "SubtitleReplacementReceipt" p ON p."replacementId"=r.id
      WHERE p.xmin::text=(txid_current()%4294967296)::text
        AND ((r."candidateSubtitleId"=candidate.id AND candidate.version=(r.snapshot#>>'{candidate,version}')::integer+1
          AND candidate.checksum=r.snapshot#>>'{candidate,checksum}' AND ((p.outcome='installed' AND candidate.state='installed' AND candidate.path=r.snapshot->>'destination')
            OR (p.outcome IN ('compensated','abandoned') AND candidate.state='failed' AND candidate.path IS NULL)))
          OR (r."oldSubtitleId"=candidate.id AND p.outcome='installed' AND candidate.state='superseded'
            AND candidate.version=(r.snapshot#>>'{old,version}')::integer+1 AND candidate.checksum=r.snapshot#>>'{old,checksum}' AND candidate.path=p.evidence->>'archivePath')))
    THEN RAISE EXCEPTION 'Automatic subtitle transition requires its exact same-transaction native receipt'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER subtitle_automatic_parent_v1 AFTER INSERT OR UPDATE ON "SubtitleAsset" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION media_subtitle_automatic_parent_v1();

-- The assigned immutable profile may require English captions for the actual
-- foreign-original movie even when nobody made a separate subtitle request.
CREATE FUNCTION media_subtitle_regular_dialogue_v1(p_caption "SubtitleAsset") RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE proof jsonb; total_speech numeric; total_covered numeric;
BEGIN
  proof:=p_caption."matchingEvidence"->'regularDialogueV1';
  IF NOT COALESCE(p_caption.language IN ('en','zh-Hans','zh-CN') AND proof->'schemaVersion'='1'::jsonb AND proof->>'detector'='ffsubsync-0.5.1/webrtc'
    AND proof->>'videoChecksum'=p_caption."videoChecksum" AND proof->>'subtitleChecksum'=p_caption.checksum
    AND jsonb_typeof(proof->'windows')='array',false) THEN RETURN false; END IF;
  IF jsonb_array_length(proof->'windows')<>12 THEN RETURN false; END IF;
  SELECT sum((w->>'speechMs')::numeric),sum((w->>'coveredSpeechMs')::numeric)
    INTO total_speech,total_covered FROM jsonb_array_elements(proof->'windows') w;
  RETURN COALESCE((proof->>'runtimeMs')::numeric BETWEEN 1 AND 28800000
    AND (proof->>'speechMs')::numeric>=least(30000,(proof->>'runtimeMs')::numeric/4)
    AND (proof->>'speechMs')::numeric<=(proof->>'runtimeMs')::numeric
    AND (proof->>'coveredSpeechMs')::numeric BETWEEN (proof->>'speechMs')::numeric*0.9 AND (proof->>'speechMs')::numeric
    AND total_speech=(proof->>'speechMs')::numeric AND total_covered=(proof->>'coveredSpeechMs')::numeric
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'windows') w
      WHERE NOT COALESCE((w->>'speechMs')::numeric>=0 AND (w->>'coveredSpeechMs')::numeric BETWEEN 0 AND (w->>'speechMs')::numeric
        AND ((w->>'speechMs')::numeric<1000 OR (w->>'coveredSpeechMs')::numeric>=(w->>'speechMs')::numeric*0.7),false)),false);
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_replacement_requested_v2(p_scope jsonb, p_language text, p_forced boolean, p_hi boolean, p_epoch integer) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_policy "MediaSubtitlePolicyVersion";
BEGIN
  IF EXISTS (SELECT 1 FROM "MediaRequest" r JOIN "MovieEditionChoice" c ON c.id=r."movieEditionChoiceId"
    JOIN "MediaUser" u ON u.id=r."userId"
    WHERE r."mediaId"=p_scope->>'mediaId' AND r.edition=p_scope->>'edition' AND r.active AND NOT r.excluded AND r.direct
      AND r."subtitleLanguages" @> ARRAY[p_language]::text[] AND NOT u.restricted
      AND c."requestId"=r.id AND c."subjectUserId"=r."userId" AND c."rootMediaId"=p_scope->>'rootMediaId'
      AND c.edition=r.edition AND c."choiceRevision"=r."movieEditionChoiceRevision") THEN RETURN true; END IF;
  IF p_language='en' AND p_forced IS FALSE AND EXISTS(
    SELECT 1 FROM "MediaIntent" t JOIN "QualityProfile" q ON q.id=t."profileId"
      JOIN "QualityProfileVersion" v ON v."profileId"=q.id AND v.version=q.version
      JOIN "MediaItem" m ON m.id=t."mediaId"
    WHERE t."mediaId"=p_scope->>'mediaId' AND t.edition=p_scope->>'edition' AND t."editionRootId"=p_scope->>'rootMediaId'
      AND t."automationEpoch"=p_epoch AND t."desiredPresence" AND t."intentionallyRemovedAt" IS NULL
      AND v.rules#>'{resolved,householdPolicy,englishCaptionsForForeignAudio}'='true'::jsonb
      AND lower(replace(trim(m."originalLanguage"),'_','-')) ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'
      AND split_part(lower(replace(trim(m."originalLanguage"),'_','-')),'-',1) NOT IN ('en','eng','und','mul','zxx')) THEN RETURN true; END IF;
  SELECT p.* INTO v_policy FROM "MediaSubtitlePolicyVersion" p WHERE p."mediaId"=p_scope->>'mediaId' AND p.edition IN ('default',p_scope->>'edition')
    ORDER BY (p.edition=p_scope->>'edition') DESC,p.version DESC LIMIT 1;
  RETURN COALESCE(v_policy."recoveryEpoch"=p_epoch AND jsonb_array_length(v_policy.rules->'protectedReasons')=0
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_policy.rules->'targets') AS entry(value) WHERE entry.value->>'language'=p_language
      AND (NOT entry.value ? 'forced' OR entry.value->'forced'=to_jsonb(p_forced))
      AND (entry.value->>'hearingImpaired'='any' OR (entry.value->>'hearingImpaired'='required' AND p_hi IS TRUE) OR (entry.value->>'hearingImpaired'='excluded' AND p_hi IS FALSE))),false);
END;
$$;


CREATE OR REPLACE FUNCTION media_movie_replacement_capture_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_asset "LibraryAsset"; v_old "SubtitleAsset"; v_candidate "SubtitleAsset"; v_owner "MediaUser";
  v_event "ApplicationEvent"; v_target "MediaIntent"; v_runtime "MediaRuntimeState"; v_scope jsonb; v_capture jsonb;
BEGIN
  IF NEW.snapshot->'schemaVersion' IS DISTINCT FROM '2'::jsonb THEN RETURN NEW; END IF;
  v_capture:=NEW.snapshot; v_scope:=v_capture->'scope';
  SELECT a.* INTO STRICT v_asset FROM "LibraryAsset" a WHERE a.id=NEW."assetId";
  SELECT s.* INTO STRICT v_old FROM "SubtitleAsset" s WHERE s.id=NEW."oldSubtitleId";
  SELECT s.* INTO STRICT v_candidate FROM "SubtitleAsset" s WHERE s.id=NEW."candidateSubtitleId";
  SELECT u.* INTO STRICT v_owner FROM "MediaUser" u WHERE u.id=NEW."ownerId";
  SELECT e.* INTO STRICT v_event FROM "ApplicationEvent" e WHERE e.id=v_capture#>>'{candidateSource,eventId}';
  SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_scope->>'mediaId' AND t.edition=v_scope->>'edition';
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  IF NOT COALESCE(media_movie_replacement_scope_v2(v_asset,v_scope) AND v_owner.role='owner' AND NOT v_owner.restricted
    AND NEW."snapshotHash" ~ '^[a-f0-9]{64}$' AND v_capture->>'libraryKind'='movies'
    AND NEW."importOperationId"='subtitle-replace-'||NEW.id AND NEW."rollbackOperationId"='subtitle-revert-'||NEW.id
    AND NEW."recoveryEpoch"=v_asset."ownershipEpoch" AND NEW."recoveryEpoch"=v_runtime."recoveryEpoch" AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed"
    AND NEW."runtimeVersion"=v_runtime.version AND v_capture->'recoveryEpoch'=to_jsonb(NEW."recoveryEpoch") AND v_capture->'runtimeVersion'=to_jsonb(v_runtime.version)
    AND v_capture#>>'{asset,id}'=v_asset.id AND v_capture#>'{asset,version}'=to_jsonb(v_asset.version) AND v_capture#>>'{asset,path}'=v_asset.path AND v_capture#>>'{asset,checksum}'=v_asset.checksum
    AND v_capture#>'{asset,ownershipEpoch}'=to_jsonb(v_asset."ownershipEpoch") AND jsonb_array_length(v_capture#>'{asset,coverage}')=1
    AND v_capture#>>'{asset,coverage,0,mediaId}'=v_scope->>'mediaId' AND v_capture#>'{asset,coverage,0,generation}'=to_jsonb(v_target.generation)
    AND v_target."editionRootId"=v_scope->>'rootMediaId' AND v_target."desiredPresence" AND v_target."intentionallyRemovedAt" IS NULL AND v_target."automationEpoch"=v_runtime."recoveryEpoch"
    AND v_old."assetId"=v_asset.id AND v_old.state='installed' AND v_old."storageKind"='sidecar'
    AND v_old."videoChecksum"=v_asset.checksum AND v_old."videoVersion"=v_asset.version AND v_old."ownershipEpoch"=v_asset."ownershipEpoch"
    AND v_candidate."assetId"=v_asset.id AND v_candidate.state='validated' AND (v_candidate.version=0 OR media_subtitle_automatic_candidate_valid_v1(v_candidate,v_old,v_asset,v_event,v_scope)) AND v_candidate."qualityStatus"='accepted' AND v_candidate."storageKind"='sidecar' AND v_candidate.path IS NULL
    AND v_candidate."videoChecksum"=v_asset.checksum AND v_candidate."videoVersion"=v_asset.version AND v_candidate."ownershipEpoch"=v_asset."ownershipEpoch"
    AND v_candidate.checksum=encode(sha256(v_candidate.content),'hex') AND v_candidate.checksum<>v_old.checksum
    AND v_candidate."matchingEvidence"->'movieScope'=v_scope AND v_candidate."matchingEvidence"->>'targetAuthority'=v_capture->>'targetAuthority'
    AND v_candidate."matchingEvidence"#>>'{replacementFor,oldSubtitleId}'=v_old.id AND v_candidate."matchingEvidence"#>'{replacementFor,expectedOldVersion}'=to_jsonb(v_old.version)
    AND ((v_candidate."matchingEvidence"#>>'{movieManualReplacementV2,eventId}'=v_event.id AND v_event.kind='movie_subtitle_replacement_candidate_v2')
      OR media_subtitle_automatic_candidate_valid_v1(v_candidate,v_old,v_asset,v_event,v_scope))
    AND v_event.payload->'scope'=v_scope AND v_event.payload->>'subtitleId'=v_candidate.id
    AND v_event.payload->>'oldSubtitleId'=v_old.id AND v_event.payload->>'assetId'=v_asset.id AND v_event.payload->>'checksum'=v_candidate.checksum
    AND v_event."actorId"=v_capture#>>'{candidateSource,actorId}' AND v_capture#>>'{candidateSource,payloadHash}' ~ '^[a-f0-9]{64}$'
    AND v_capture->'old'=media_movie_restore_caption_snapshot(v_old) AND v_capture->'candidate'=media_movie_restore_caption_snapshot(v_candidate)
    AND v_capture->>'destination'=v_old.path AND media_movie_subtitle_parent(v_capture->'publication',v_asset,v_scope)
    AND media_movie_replacement_source_v2(v_capture->'source',v_capture->'old',v_asset,v_scope,v_capture->'publication')
    AND media_movie_replacement_requested_v2(v_scope,v_candidate.language,
      CASE WHEN v_candidate.forced IS NULL AND media_subtitle_regular_dialogue_v1(v_candidate) THEN false ELSE v_candidate.forced END,
      v_candidate."hearingImpaired",v_runtime."recoveryEpoch"),false)
  THEN RAISE EXCEPTION 'Movie caption replacement requires its exact actual owner, video, upload and caption source'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_replacement_receipt_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_replacement "SubtitleReplacement"; v_asset "LibraryAsset"; v_old "SubtitleAsset"; v_candidate "SubtitleAsset";
  v_command "Operation"; v_review "SubtitleReplacementReview"; v_target "MediaIntent"; v_runtime "MediaRuntimeState";
  v_proof jsonb; v_capture jsonb; v_scope jsonb; v_expected jsonb;
BEGIN
  SELECT r.* INTO STRICT v_replacement FROM "SubtitleReplacement" r WHERE r.id=NEW."replacementId";
  IF v_replacement.snapshot->'schemaVersion' IS DISTINCT FROM '2'::jsonb THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  v_proof:=NEW.evidence; v_capture:=v_replacement.snapshot; v_scope:=v_capture->'scope';
  SELECT a.* INTO STRICT v_asset FROM "LibraryAsset" a WHERE a.id=v_replacement."assetId";
  SELECT s.* INTO STRICT v_old FROM "SubtitleAsset" s WHERE s.id=v_replacement."oldSubtitleId";
  SELECT s.* INTO STRICT v_candidate FROM "SubtitleAsset" s WHERE s.id=v_replacement."candidateSubtitleId";
  SELECT o.* INTO STRICT v_command FROM "Operation" o WHERE o.id=v_proof#>>'{command,operationId}';
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton';
  IF NOT COALESCE(v_proof->'schemaVersion'='2'::jsonb AND v_proof->'scope'=v_scope AND v_proof->>'snapshotHash'=v_replacement."snapshotHash"
    AND v_proof->'recoveryEpoch'=to_jsonb(v_replacement."recoveryEpoch") AND v_proof->>'oldSubtitleId'=v_replacement."oldSubtitleId" AND v_proof->>'candidateSubtitleId'=v_replacement."candidateSubtitleId"
    AND v_proof->'videoVersion'=v_capture#>'{asset,version}' AND v_proof->>'oldPath'=v_capture->>'destination'
    AND v_proof->>'importOperationId'=v_replacement."importOperationId" AND v_proof->>'rollbackOperationId'=v_replacement."rollbackOperationId"
    AND v_proof->'source'=v_capture->'source' AND v_proof#>'{before,old}'=v_capture->'old' AND v_proof#>'{before,candidate}'=v_capture->'candidate'
    AND v_command.id=v_replacement."coordinatorOperationId" AND v_command.kind IN ('apply_subtitle_replacement','reconcile_subtitle_replacement','prepare_subtitle_replacement')
    AND v_command."targetId"=v_replacement.id AND v_command.payload->>'replacementId'=v_replacement.id AND v_command.payload->'movieScope'=v_scope
    AND v_proof#>>'{command,kind}'=v_command.kind AND v_proof#>'{command,actorId}'=COALESCE(to_jsonb(v_command."userId"),'null'::jsonb)
    AND v_proof#>>'{command,payloadHash}' ~ '^[a-f0-9]{64}$' AND media_movie_replacement_scope_v2(v_asset,v_scope)
    AND v_asset.version=(v_capture#>>'{asset,version}')::integer AND v_asset.path=v_capture#>>'{asset,path}' AND v_asset.checksum=v_capture#>>'{asset,checksum}'
    AND v_asset."ownershipEpoch"=v_replacement."recoveryEpoch" AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed" AND v_runtime."recoveryEpoch"=v_replacement."recoveryEpoch" AND v_runtime.version=v_replacement."runtimeVersion"
    AND v_proof#>'{after,old}'=media_movie_restore_caption_snapshot(v_old) AND v_proof#>'{after,candidate}'=media_movie_restore_caption_snapshot(v_candidate)
    AND EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s.id=v_candidate.id AND s.xmin::text=(txid_current()%4294967296)::text)
    AND media_movie_replacement_source_v2(v_capture->'source',v_capture->'old',v_asset,v_scope,v_capture->'publication')
    AND (v_proof->>'settledAt')::timestamptz<=clock_timestamp() AND (v_proof->>'settledAt')::timestamptz>=(v_proof->>'observedAt')::timestamptz
    AND (v_proof->>'settledAt')::timestamptz<(v_proof->>'expiresAt')::timestamptz
    AND (v_proof->>'expiresAt')::timestamptz<=(v_proof->>'observedAt')::timestamptz+interval '60 seconds'
    AND (v_proof->>'expiresAt')::timestamptz<=(v_proof->>'sdkExpiresAt')::timestamptz
    AND EXTRACT(EPOCH FROM (v_proof->>'expiresAt')::timestamptz)*1000<=NULLIF(current_setting('media.plex_deadline_ms',true),'')::numeric,false)
  THEN RAISE EXCEPTION 'Movie caption replacement receipt requires its exact native transition and original deadline'; END IF;
  IF NEW.outcome='installed' THEN
    SELECT r.* INTO STRICT v_review FROM "SubtitleReplacementReview" r WHERE r."replacementId"=v_replacement.id;
    SELECT t.* INTO STRICT v_target FROM "MediaIntent" t WHERE t."mediaId"=v_scope->>'mediaId' AND t.edition=v_scope->>'edition';
    v_expected:=(v_capture->'candidate')||jsonb_build_object('state','installed','path',v_capture->>'destination','version',(v_capture#>>'{candidate,version}')::integer+1,
      'matchingEvidence',(v_capture#>'{candidate,matchingEvidence}')||jsonb_build_object('movieReplacementV2',jsonb_build_object('schemaVersion',2,'replacementId',v_replacement.id)));
    IF NOT COALESCE(v_candidate.state='installed' AND v_candidate.version=(v_capture#>>'{candidate,version}')::integer+1 AND v_proof#>'{after,candidate}'=v_expected
      AND v_old.state='superseded' AND v_old.version=(v_capture#>>'{old,version}')::integer+1
      AND v_old.path=v_proof->>'archivePath' AND v_old.path='/data/movies/.media-control/rollback/'||v_replacement."importOperationId"
      AND v_proof#>'{after,old}'=(v_capture->'old')||jsonb_build_object('state','superseded','path',v_old.path,'version',v_old.version)
      AND EXISTS (SELECT 1 FROM "SubtitleAsset" s WHERE s.id=v_old.id AND s.xmin::text=(txid_current()%4294967296)::text)
      AND ((v_review."approvedById" IS NOT NULL AND v_review."approvedAt"<=(clock_timestamp() AT TIME ZONE 'UTC'))
        OR media_subtitle_automatic_authorization_valid_v1(v_replacement,v_review))
      AND v_review."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
      AND (v_review."approvedById" IS NULL OR EXISTS (SELECT 1 FROM "MediaUser" u WHERE u.id=v_review."approvedById" AND u.role='owner' AND NOT u.restricted))
      AND EXISTS (SELECT 1 FROM "MediaUser" u WHERE u.id=v_replacement."ownerId" AND u.role='owner' AND NOT u.restricted)
      AND v_target."desiredPresence" AND v_target."intentionallyRemovedAt" IS NULL AND v_target."automationEpoch"=v_replacement."recoveryEpoch"
      AND media_movie_replacement_requested_v2(v_scope,v_candidate.language,
        CASE WHEN v_candidate.forced IS NULL AND media_subtitle_regular_dialogue_v1(v_candidate) THEN false ELSE v_candidate.forced END,
        v_candidate."hearingImpaired",v_runtime."recoveryEpoch")
      AND to_jsonb(v_target.generation)=v_capture#>'{asset,coverage,0,generation}'
      AND v_proof#>>'{journal,operationId}'=v_replacement."importOperationId" AND v_proof#>>'{journal,kind}'='import' AND v_proof#>>'{journal,phase}'='complete'
      AND v_proof#>>'{journal,target}'=v_candidate.path AND v_proof#>>'{journal,sha256}'=v_candidate.checksum AND v_proof#>>'{journal,previousSha256}'=v_old.checksum,false)
    THEN RAISE EXCEPTION 'Installed movie replacement requires its exact reviewed same-transaction caption swap'; END IF;
  ELSE
    IF NOT COALESCE(v_candidate.state='failed' AND v_proof#>'{after,old}'=v_capture->'old'
      AND v_proof#>'{after,candidate}'=(v_capture->'candidate')||jsonb_build_object('state','failed','version',(v_capture#>>'{candidate,version}')::integer+1),false)
    THEN RAISE EXCEPTION 'Movie replacement compensation changed its unchanged original caption'; END IF;
  END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_replacement_candidate_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD."matchingEvidence" ? 'movieManualReplacementV2' OR OLD."matchingEvidence" ? 'automaticSubtitleUpgradeV1') THEN RETURN NEW; END IF;
  IF (NEW.id,NEW."assetId",NEW.language,NEW."providerId",NEW."qualityStatus",NEW."storageKind",NEW.checksum,NEW.content,
      NEW."videoChecksum",NEW.forced,NEW."hearingImpaired",NEW."streamIndex",NEW.codec,NEW.provenance)
    IS DISTINCT FROM (OLD.id,OLD."assetId",OLD.language,OLD."providerId",OLD."qualityStatus",OLD."storageKind",OLD.checksum,OLD.content,
      OLD."videoChecksum",OLD.forced,OLD."hearingImpaired",OLD."streamIndex",OLD.codec,OLD.provenance)
    OR (NEW."matchingEvidence"-'movieReplacementV2') IS DISTINCT FROM (OLD."matchingEvidence"-'movieReplacementV2')
    OR (OLD."matchingEvidence" ? 'movieReplacementV2' AND NEW."matchingEvidence"->'movieReplacementV2' IS DISTINCT FROM OLD."matchingEvidence"->'movieReplacementV2')
  THEN RAISE EXCEPTION 'Movie replacement uploaded bytes and source are immutable'; END IF;
  RETURN NEW;
END;
$$;
