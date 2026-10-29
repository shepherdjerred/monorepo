-- Additive guards for the actual restore/removal notices; historical publication notice triggers stay literal.
CREATE FUNCTION media_movie_post_effect_notice_event_v4() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command "Operation"; quarantine "Operation"; decision "RetentionDecision"; target "MediaIntent";
  choice "MovieEditionChoice"; request "MediaRequest"; asset "LibraryAsset"; runtime "MediaRuntimeState"; writer "LegacyWriterLease";
  body jsonb; source jsonb; proof jsonb; selected jsonb; group_value jsonb; binding jsonb; stage text; expected_version integer;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.payload->>'kind' IN ('movie_restoration','movie_removal') THEN RAISE EXCEPTION 'Movie post-effect notification source is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.payload->>'kind' IN ('movie_restoration','movie_removal') THEN
    IF (NEW.id,NEW."dedupeKey",NEW."mediaId",NEW."actorId",NEW.kind,NEW.payload) IS DISTINCT FROM (OLD.id,OLD."dedupeKey",OLD."mediaId",OLD."actorId",OLD.kind,OLD.payload)
    THEN RAISE EXCEPTION 'Movie post-effect notification source is immutable'; END IF;
    RETURN NEW;
  END IF;
  body:=NEW.payload;
  IF body->>'kind' NOT IN ('movie_restoration','movie_removal') OR body->>'kind' IS NULL THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  source:=body->'source'; selected:=source->'scope';
  SELECT * INTO STRICT command FROM "Operation" WHERE id=source->>'operationId';
  SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=NEW."mediaId" AND edition=selected->>'edition';
  SELECT * INTO STRICT choice FROM "MovieEditionChoice" WHERE id=body #>> '{request,choiceId}';
  SELECT * INTO STRICT request FROM "MediaRequest" WHERE id=body #>> '{request,id}';
  SELECT * INTO STRICT runtime FROM "MediaRuntimeState" WHERE id='singleton';
  SELECT * INTO STRICT writer FROM "LegacyWriterLease" WHERE id='singleton';
  IF NOT COALESCE(jsonb_typeof(body)='object' AND body->'schemaVersion'='4'::jsonb
    AND body ?& ARRAY['schemaVersion','kind','eventKind','source','generation','recoveryEpoch','request','asset']
    AND body->>'eventKind'=NEW.kind AND selected->>'mediaId'=NEW."mediaId" AND selected->>'rootMediaId'=NEW."mediaId"
    AND selected ?& ARRAY['rootMediaId','mediaId','edition'] AND selected-ARRAY['rootMediaId','mediaId','edition']='{}'::jsonb
    AND source->'schemaVersion'='4'::jsonb AND source->>'operationId'=command.id
    AND command."targetId"=NEW."mediaId" AND command.payload->>'operationId'=command.id AND command.payload->>'kind'=command.kind
    AND command.payload->'scope'=selected AND command.payload->'generation'=body->'generation'
    AND command.payload->'recoveryEpoch'=body->'recoveryEpoch'
    AND body->'request' ?& ARRAY['id','choiceId','choiceRevision'] AND (body->'request')-ARRAY['id','choiceId','choiceRevision']='{}'::jsonb
    AND body->'asset' ?& ARRAY['id','version','checksum'] AND (body->'asset')-ARRAY['id','version','checksum']='{}'::jsonb
    AND body #>> '{request,id}'=choice."requestId" AND body #> '{request,choiceRevision}'=to_jsonb(choice."choiceRevision")
    AND choice."requestId"=request.id AND choice."subjectUserId"=request."userId" AND choice."actorId"=NEW."actorId"
    AND choice."rootMediaId"=NEW."mediaId" AND choice.edition=selected->>'edition'
    AND request."mediaId"=NEW."mediaId" AND request.edition=selected->>'edition' AND request.active AND NOT request.excluded AND request.direct
    AND request."movieEditionChoiceId"=choice.id AND request."movieEditionChoiceRevision"=choice."choiceRevision"
    AND target."editionRootId"=NEW."mediaId" AND to_jsonb(target.generation)=body->'generation'
    AND to_jsonb(target."automationEpoch")=body->'recoveryEpoch'
    AND runtime.mode='active' AND runtime."ownershipConfirmed" AND to_jsonb(runtime."recoveryEpoch")=body->'recoveryEpoch'
    AND writer."recoveryEpoch"=runtime."recoveryEpoch" AND writer."revokedAt" IS NULL
    AND writer."observedAt"<=clock_timestamp() AND writer."expiresAt">clock_timestamp(),false)
  THEN RAISE EXCEPTION 'Movie post-effect notice requires its exact actual command, current target and personal choice'; END IF;
  IF body->>'kind'='movie_restoration' THEN
    proof:=command.result #> '{movieRestorePlexReceiptV1,receipt}';
    group_value:=proof #> '{expected,newGroups,0}'; binding:=proof->'binding';
    SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=group_value->>'assetId';
    IF NOT COALESCE(body ? 'publicationHash'
      AND body-ARRAY['schemaVersion','kind','eventKind','source','publicationHash','generation','recoveryEpoch','request','asset']='{}'::jsonb
      AND source ?& ARRAY['schemaVersion','operationId','mediaId','generation','scope']
      AND source-ARRAY['schemaVersion','operationId','mediaId','generation','scope']='{}'::jsonb
      AND command.kind='restore_movie_edition_v4' AND NEW.kind='media_available'
      AND proof->'schemaVersion'='1'::jsonb AND source=proof->'input'
      AND body->>'publicationHash'=command.result #>> '{movieRestorePlexReceiptV1,receiptHash}'
      AND body #>> '{asset,id}'=asset.id AND body #> '{asset,version}'=to_jsonb(asset.version)
      AND body #>> '{asset,checksum}'=asset.checksum AND asset.state='published' AND asset.owned
      AND asset.id=group_value->>'assetId' AND to_jsonb(asset.version)=group_value->'assetVersion'
      AND asset.checksum=group_value->>'checksum' AND asset.path=group_value->>'canonicalPath'
      AND asset.edition=selected->>'edition' AND asset."editionRootId"=NEW."mediaId"
      AND to_jsonb(asset."ownershipEpoch")=body->'recoveryEpoch'
      AND target.availability='available' AND target."desiredPresence" AND target."intentionallyRemovedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "PlexBindingCurrent" p WHERE p."mediaId"=NEW."mediaId" AND p.edition=selected->>'edition'
        AND p."evidenceId"=binding->>'evidenceId' AND p."associationHash"=binding->>'associationHash' AND to_jsonb(p.revision)=binding->'revision')
      AND EXISTS (SELECT 1 FROM "PlexAssociationEvidence" e WHERE e.id=binding->>'evidenceId'
        AND e.evidence=proof #> '{observation,associations,0}' AND e."associationHash"=binding->>'associationHash'
        AND e."assetId"=asset.id AND e."mediaId"=NEW."mediaId" AND e.edition=selected->>'edition'),false)
    THEN RAISE EXCEPTION 'Movie restoration notice requires its actual scoped restore serving receipt'; END IF;
  ELSE
    stage:=source->>'stage';
    SELECT * INTO STRICT decision FROM "RetentionDecision" WHERE id=source->>'decisionId';
    IF stage='quarantined' THEN quarantine:=command;
    ELSIF stage='purged' THEN
      SELECT * INTO STRICT quarantine FROM "Operation" WHERE kind='retain_movie_edition_v4'
        AND result #>> '{movieQuarantinePlexReceiptV2,decisionId}'=decision.id;
    ELSE RAISE EXCEPTION 'Movie removal notice stage is unknown'; END IF;
    proof:=quarantine.result->'movieQuarantinePlexReceiptV2'; group_value:=proof #> '{groups,0}';
    expected_version:=(group_value->>'assetVersion')::integer+CASE stage WHEN 'quarantined' THEN 1 ELSE 2 END;
    SELECT * INTO STRICT asset FROM "LibraryAsset" WHERE id=group_value->>'assetId';
    IF NOT COALESCE(body ? 'sourceHash' AND body->>'sourceHash' ~ '^[a-f0-9]{64}$'
      AND body-ARRAY['schemaVersion','kind','eventKind','source','sourceHash','generation','recoveryEpoch','request','asset']='{}'::jsonb
      AND source ?& ARRAY['schemaVersion','operationId','decisionId','scope','stage']
      AND source-ARRAY['schemaVersion','operationId','decisionId','scope','stage']='{}'::jsonb
      AND command.kind='retain_movie_edition_v4' AND quarantine.kind='retain_movie_edition_v4'
      AND quarantine.payload->'scope'=selected AND quarantine.payload->'generation'=body->'generation'
      AND quarantine.payload->'recoveryEpoch'=body->'recoveryEpoch'
      AND proof->'schemaVersion'='2'::jsonb AND proof->>'operationId'=quarantine.id AND proof->>'decisionId'=decision.id
      AND proof->'scope'=selected AND proof->'recoveryEpoch'=body->'recoveryEpoch'
      AND decision."mediaId"=NEW."mediaId" AND decision.edition=selected->>'edition'
      AND to_jsonb(decision.generation)=body->'generation' AND decision.state::text=stage
      AND decision.version=(proof #>> '{decisions,0,quarantinedVersion}')::integer+CASE stage WHEN 'quarantined' THEN 0 ELSE 1 END
      AND decision."quarantinedAt"=(proof->>'committedAt')::timestamptz
      AND decision."purgeAfter"=decision."quarantinedAt"+interval '7 days'
      AND (stage<>'purged' OR decision.evidence->>'purgeOperationId'=command.id)
      AND NEW.kind=CASE stage WHEN 'quarantined' THEN 'files_quarantined' ELSE 'files_purged' END
      AND target.availability::text=CASE stage WHEN 'quarantined' THEN 'quarantined' ELSE 'removed' END
      AND body #>> '{asset,id}'=asset.id AND (body #>> '{asset,version}')::integer=expected_version
      AND body #>> '{asset,checksum}'=group_value->>'checksum' AND asset.checksum=group_value->>'checksum'
      AND asset.version=expected_version AND asset.state::text=stage AND asset.owned
      AND asset.edition=selected->>'edition' AND asset."editionRootId"=NEW."mediaId"
      AND to_jsonb(asset."ownershipEpoch")=body->'recoveryEpoch' AND asset.path=group_value->>'canonicalPath'
      AND (SELECT count(*) FROM "AssetCoverage" WHERE "assetId"=asset.id)=1
      AND EXISTS (SELECT 1 FROM "AssetCoverage" WHERE "assetId"=asset.id AND "mediaId"=NEW."mediaId" AND edition=selected->>'edition' AND current=(stage='quarantined')),false)
    THEN RAISE EXCEPTION 'Movie removal notice requires its actual completed scoped removal and quarantine parent'; END IF;
  END IF;
  PERFORM media_plex_assert_deadline();
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_post_effect_notice_event_v4 BEFORE INSERT OR UPDATE OR DELETE ON "ApplicationEvent"
  FOR EACH ROW EXECUTE FUNCTION media_movie_post_effect_notice_event_v4();

CREATE FUNCTION media_movie_post_effect_notice_delivery_v4() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event "ApplicationEvent"; previous "ApplicationEvent"; choice "MovieEditionChoice";
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT * INTO STRICT previous FROM "ApplicationEvent" WHERE id=OLD."eventId";
    IF previous.payload->>'kind' IN ('movie_restoration','movie_removal') THEN RAISE EXCEPTION 'Movie post-effect notification delivery is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    SELECT * INTO STRICT previous FROM "ApplicationEvent" WHERE id=OLD."eventId";
    IF previous.payload->>'kind' IN ('movie_restoration','movie_removal') AND
      (NEW.id,NEW."eventId",NEW."userId",NEW.channel,NEW."recoveryEpoch") IS DISTINCT FROM (OLD.id,OLD."eventId",OLD."userId",OLD.channel,OLD."recoveryEpoch")
    THEN RAISE EXCEPTION 'Movie post-effect notification recipient and source are immutable'; END IF;
  END IF;
  SELECT * INTO STRICT event FROM "ApplicationEvent" WHERE id=NEW."eventId";
  IF event.payload->>'kind' NOT IN ('movie_restoration','movie_removal') OR event.payload->>'kind' IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO STRICT choice FROM "MovieEditionChoice" WHERE id=event.payload #>> '{request,choiceId}';
  IF NOT COALESCE(NEW."userId"=choice."subjectUserId" AND NEW.channel IN ('email','discord')
    AND to_jsonb(NEW."recoveryEpoch")=event.payload->'recoveryEpoch',false)
  THEN RAISE EXCEPTION 'Movie post-effect notification delivery must retain its exact personal recipient'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER movie_post_effect_notice_delivery_v4 BEFORE INSERT OR UPDATE OR DELETE ON "NotificationDelivery"
  FOR EACH ROW EXECUTE FUNCTION media_movie_post_effect_notice_delivery_v4();
