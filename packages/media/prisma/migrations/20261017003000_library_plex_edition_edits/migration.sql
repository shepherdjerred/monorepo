-- One durable send intent and one immutable readback per reviewed physical movie.
CREATE UNIQUE INDEX "MediaHandoffObservation_plex_edit_checkpoint"
  ON "MediaHandoffObservation" ("planId",kind,(evidence->>'assetId'))
  WHERE kind IN ('plex_edit_intent_v1','plex_edit_completion_v1');

CREATE FUNCTION media_library_plex_edit_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB := NEW.evidence; plan "MediaHandoffPlan"; command "Operation";
  files "MediaHandoffObservation"; network "MediaHandoffObservation"; intent "MediaHandoffObservation";
  change JSONB; selected JSONB; reviewed JSONB;
BEGIN
  IF NEW.kind NOT IN ('plex_edit_intent_v1','plex_edit_completion_v1') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  SELECT * INTO STRICT plan FROM "MediaHandoffPlan" WHERE id=NEW."planId" FOR UPDATE;
  SELECT * INTO STRICT command FROM "Operation" WHERE id=proof->>'operationId' FOR SHARE;
  IF NOT COALESCE(proof->'schemaVersion'='1'::jsonb AND plan.scope->'schemaVersion'='3'::jsonb
    AND plan.scope #>> '{request,plexEditionLabels}'='update_in_place' AND plan.plan->'schemaVersion'='3'::jsonb
    AND proof->>'planId'=plan.id AND proof->>'planHash'=plan."planHash"
    AND proof->'recoveryEpoch'=to_jsonb(plan."recoveryEpoch")
    AND command.kind='apply_library_handoff_v3' AND command."targetId"=plan.id
    AND command.payload->'schemaVersion'='3'::jsonb AND command.payload->>'planId'=plan.id
    AND command.payload->>'planHash'=plan."planHash" AND command."userId"=command.payload->>'actorId',false)
  THEN RAISE EXCEPTION 'Plex edition checkpoint requires its original explicit command'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(plan.plan->'plexEdits') c WHERE c->>'assetId'=proof->>'assetId')<>1
    OR (SELECT count(*) FROM jsonb_array_elements(plan.scope->'files') f WHERE f->>'assetId'=proof->>'assetId')<>1
  THEN RAISE EXCEPTION 'Plex edition checkpoint has ambiguous classification'; END IF;
  SELECT c INTO STRICT change FROM jsonb_array_elements(plan.plan->'plexEdits') c WHERE c->>'assetId'=proof->>'assetId';
  SELECT f INTO STRICT selected FROM jsonb_array_elements(plan.scope->'files') f WHERE f->>'assetId'=proof->>'assetId';
  SELECT f INTO STRICT reviewed FROM jsonb_array_elements(plan.plan #> '{files,files}') f WHERE f->>'assetId'=proof->>'assetId';
  SELECT * INTO STRICT files FROM "MediaHandoffObservation" WHERE id=proof #>> '{filesObservation,id}';
  SELECT * INTO STRICT network FROM "MediaHandoffObservation" WHERE id=proof #>> '{networkObservation,id}';
  IF NOT COALESCE(selected->>'libraryKind'='movies' AND selected->'existingAssetId'='null'::jsonb
    AND selected->>'edition'=change #>> '{scope,edition}' AND selected->'classification'<>'null'::jsonb
    AND selected->>'canonicalPath'=change #>> '{identity,canonicalPath}'
    AND proof #> '{before,identity}'=change->'identity' AND proof #>> '{before,identityHash}'=change->>'identityHash'
    AND files.kind='plex_edit_files_v1' AND files."planId"=plan.id
    AND files."evidenceHash"=proof #>> '{filesObservation,evidenceHash}'
    AND files.evidence->>'operationId'=command.id AND files.evidence->>'assetId'=selected->>'assetId'
    AND files.evidence->>'planHash'=plan."planHash" AND files.evidence->'recoveryEpoch'=to_jsonb(plan."recoveryEpoch")
    AND files.evidence->'file'=reviewed AND files.evidence->'networkObservation'=proof->'networkObservation'
    AND network.kind='network' AND network."planId"=plan.id
    AND network."evidenceHash"=proof #>> '{networkObservation,evidenceHash}'
    AND network.evidence->'schemaVersion'='3'::jsonb AND network.evidence->'recoveryEpoch'=to_jsonb(plan."recoveryEpoch")
    AND files."observedAt"=(files.evidence->>'capturedAt')::timestamptz
    AND files."expiresAt"=(files.evidence->>'expiresAt')::timestamptz
    AND files."expiresAt"<=network."expiresAt"
    AND files."expiresAt"<=(files.evidence->>'readSdkExpiresAt')::timestamptz
    AND files."expiresAt"<=files."observedAt"+interval '90 seconds'
    AND NEW."observedAt"=(proof->>'observedAt')::timestamptz AND NEW."expiresAt"=(proof->>'expiresAt')::timestamptz
    AND NEW."observedAt"<=clock_timestamp() AND NEW."expiresAt">clock_timestamp()
    AND NEW."expiresAt"<=NEW."observedAt"+interval '60 seconds'
    AND NEW."expiresAt"<=(proof->>'sdkExpiresAt')::timestamptz
    AND EXTRACT(EPOCH FROM NEW."expiresAt")*1000<=NULLIF(current_setting('media.plex_deadline_ms',true),'')::numeric,false)
  THEN RAISE EXCEPTION 'Plex edition checkpoint original file, network or SDK authority changed'; END IF;
  IF NEW.kind='plex_edit_intent_v1' THEN
    IF NOT COALESCE(plan.state='applying' AND plan."expiresAt">clock_timestamp()
      AND COALESCE(proof #>> '{before,editionTitle}','')=COALESCE(change->>'beforeEditionTitle','')
      AND NEW."observedAt">=files."observedAt" AND NEW."expiresAt"<=files."expiresAt"
      AND network."expiresAt">clock_timestamp(),false)
    THEN RAISE EXCEPTION 'Plex edition send intent is not live original authority'; END IF;
  ELSE
    IF NOT COALESCE(proof #> '{after,identity}'=proof #> '{before,identity}'
      AND proof #> '{after,identityHash}'=proof #> '{before,identityHash}'
      AND COALESCE(proof #>> '{after,editionTitle}','')=change->>'targetEditionTitle'
      AND (proof #>> '{after,watch,viewCount}')::bigint >= (proof #>> '{before,watch,viewCount}')::bigint
      AND COALESCE((proof #>> '{after,watch,lastViewedAt}')::bigint,-1)>=COALESCE((proof #>> '{before,watch,lastViewedAt}')::bigint,-1)
      AND ((proof #>> '{after,watch,viewCount}')::bigint > (proof #>> '{before,watch,viewCount}')::bigint
        OR COALESCE((proof #>> '{after,watch,viewOffset}')::bigint,0)>=COALESCE((proof #>> '{before,watch,viewOffset}')::bigint,0)),false)
    THEN RAISE EXCEPTION 'Plex edition readback changed the item, label or watch state'; END IF;
    IF proof->'intent'='null'::jsonb THEN
      IF proof->>'response'<>'not_sent' OR EXISTS (SELECT 1 FROM "MediaHandoffObservation" o
        WHERE o."planId"=plan.id AND o.kind='plex_edit_intent_v1' AND o.evidence->>'assetId'=proof->>'assetId')
      THEN RAISE EXCEPTION 'Plex edition observation cannot hide an existing send intent'; END IF;
    ELSE
      SELECT * INTO STRICT intent FROM "MediaHandoffObservation" WHERE id=proof #>> '{intent,id}';
      IF NOT COALESCE(intent.kind='plex_edit_intent_v1' AND intent."planId"=plan.id
        AND intent."evidenceHash"=proof #>> '{intent,evidenceHash}'
        AND intent.evidence->>'operationId'=command.id AND intent.evidence->>'assetId'=proof->>'assetId'
        AND intent.evidence->'before'=proof->'before' AND intent.evidence->'filesObservation'=proof->'filesObservation'
        AND intent.evidence->'networkObservation'=proof->'networkObservation'
        AND proof->>'response' IN ('acknowledged','lost_or_unobserved'),false)
      THEN RAISE EXCEPTION 'Plex edition completion has no original send intent'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MediaHandoffObservation_plex_edit_guard" BEFORE INSERT ON "MediaHandoffObservation"
  FOR EACH ROW EXECUTE FUNCTION media_library_plex_edit_checkpoint();

CREATE FUNCTION media_library_plex_command_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MediaHandoffObservation" WHERE kind IN ('plex_edit_intent_v1','plex_edit_completion_v1')
    AND evidence->>'operationId'=OLD.id)
    AND (TG_OP='DELETE' OR (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload)
      IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload))
  THEN RAISE EXCEPTION 'Plex edition original command is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Operation_plex_edit_immutable" BEFORE UPDATE OR DELETE ON "Operation"
  FOR EACH ROW EXECUTE FUNCTION media_library_plex_command_immutable();
