-- Initial-library serving proof has its own command and receipt, without acquisition history.
CREATE FUNCTION media_library_plex_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof JSONB; envelope JSONB; source "MediaHandoffReceipt"; plan "MediaHandoffPlan";
  baseline JSONB; physical JSONB; coverage JSONB; binding JSONB; association JSONB;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.result,'{}'::jsonb) ? 'libraryPlexReceiptV1' THEN RAISE EXCEPTION 'Committed library Plex receipt is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.result,'{}'::jsonb) ? 'libraryPlexReceiptV1' THEN
    IF NEW.result->'libraryPlexReceiptV1' IS DISTINCT FROM OLD.result->'libraryPlexReceiptV1'
      OR (NEW.id,NEW."idempotencyKey",NEW.kind,NEW."targetId",NEW."userId",NEW.payload) IS DISTINCT FROM (OLD.id,OLD."idempotencyKey",OLD.kind,OLD."targetId",OLD."userId",OLD.payload)
    THEN RAISE EXCEPTION 'Committed library Plex receipt or command is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.result,'{}'::jsonb) ? 'libraryPlexReceiptV1') THEN RETURN NEW; END IF;
  PERFORM media_plex_assert_deadline();
  envelope := NEW.result->'libraryPlexReceiptV1'; proof := envelope->'receipt';
  SELECT * INTO STRICT source FROM "MediaHandoffReceipt" WHERE id=proof #>> '{input,receiptId}';
  SELECT * INTO STRICT plan FROM "MediaHandoffPlan" WHERE id=source."planId";
  SELECT value INTO STRICT baseline FROM jsonb_array_elements(source.selection->'assets') WHERE value->>'id'=NEW."targetId";
  physical := proof #> '{expected,newGroups,0}';
  SELECT jsonb_agg(jsonb_build_object('mediaId',value->>'mediaId','edition',value->>'edition') ORDER BY value->>'mediaId',value->>'edition')
    INTO coverage FROM jsonb_array_elements(baseline->'coverage');
  IF NOT COALESCE(envelope->>'receiptHash' ~ '^[a-f0-9]{64}$' AND proof->'schemaVersion'='1'::jsonb
    AND NEW.kind='verify_library_plex_binding' AND NEW.payload=proof->'input'
    AND proof #>> '{input,operationId}'=NEW.id AND proof #>> '{input,assetId}'=NEW."targetId"
    AND proof #> '{input,recoveryEpoch}'=to_jsonb(source."recoveryEpoch")
    AND plan.state='applied' AND plan."planHash"=source."planHash"
    AND NEW."userId"=source."actorId"
    AND source.selection->'schemaVersion' IN ('2'::jsonb,'3'::jsonb)
    AND proof #> '{expected,schemaVersion}'='2'::jsonb
    AND jsonb_array_length(proof #> '{expected,newGroups}')=1 AND jsonb_array_length(proof #> '{expected,parents}')=1
    AND proof #>> '{expected,parents,0,kind}'='library_adoption'
    AND proof #>> '{expected,parents,0,reference,kind}'='library_adoption_v1'
    AND proof #>> '{expected,parents,0,reference,receiptId}'=source.id
    AND proof #>> '{expected,parents,0,reference,planId}'=plan.id
    AND proof #>> '{expected,parents,0,reference,planHash}'=source."planHash"
    AND proof #>> '{expected,parents,0,reference,assetId}'=NEW."targetId"
    AND proof #> '{expected,parents,0,reference,assetVersion}'='0'::jsonb
    AND proof #> '{expected,recoveryEpoch}'=to_jsonb(source."recoveryEpoch")
    AND proof #> '{expected,parents,0,recoveryEpoch}'=to_jsonb(source."recoveryEpoch")
    AND physical->>'assetId'=baseline->>'id' AND physical->'assetVersion'=baseline->'version' AND baseline->'version'='0'::jsonb
    AND physical->>'checksum'=baseline->>'checksum' AND physical->>'sizeBytes'=baseline->>'sizeBytes'
    AND physical->>'canonicalPath'=baseline->>'path' AND physical->'ownershipEpoch'=baseline->'ownershipEpoch'
    AND physical->>'canonicalRootId'=baseline->>'editionRootId' AND physical->>'edition'=baseline->>'edition'
    AND physical->'coverage'=coverage AND baseline->>'state'='published' AND baseline->'owned'='true'::jsonb
    AND proof #>> '{command,kind}'=NEW.kind AND proof #>> '{command,targetId}'=NEW."targetId"
    AND (proof #>> '{command,userId}') IS NOT DISTINCT FROM NEW."userId"
    AND jsonb_array_length(proof->'bindings')=jsonb_array_length(coverage)
    AND (SELECT count(DISTINCT value->'scope') FROM jsonb_array_elements(proof->'bindings'))=jsonb_array_length(coverage)
    AND jsonb_array_length(proof #> '{observation,associations}')=jsonb_array_length(coverage)
    AND (proof #>> '{sdk,observedAt}')::timestamptz <= (proof #>> '{observation,verification,startedAt}')::timestamptz
    AND (proof #>> '{observation,verification,expiresAt}')::timestamptz <= (proof #>> '{sdk,expiresAt}')::timestamptz
    AND (proof #>> '{observation,verification,expiresAt}')::timestamptz <= (proof->>'writerExpiresAt')::timestamptz
    AND (proof #>> '{observation,verification,expiresAt}')::timestamptz <= (proof #>> '{sdk,observedAt}')::timestamptz + interval '60 seconds'
    AND (proof->>'committedAt')::timestamptz <= clock_timestamp()
    AND (proof->>'committedAt')::timestamptz >= (proof #>> '{observation,verification,completedAt}')::timestamptz
    AND (proof->>'committedAt')::timestamptz < (proof #>> '{observation,verification,expiresAt}')::timestamptz,false)
  THEN RAISE EXCEPTION 'Library Plex receipt lost its exact command, initial physical owner or original verification bounds'; END IF;
  FOR binding IN SELECT value FROM jsonb_array_elements(proof->'bindings') LOOP
    SELECT value INTO STRICT association FROM jsonb_array_elements(proof #> '{observation,associations}') WHERE value->'scope'=binding->'scope';
    IF association->'group' IS DISTINCT FROM physical OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coverage) scope WHERE scope=binding->'scope')
      OR NOT EXISTS (SELECT 1 FROM "PlexBindingCurrent" c JOIN "PlexAssociationEvidence" e ON e.id=c."evidenceId"
        WHERE c."mediaId"=binding #>> '{scope,mediaId}' AND c.edition=binding #>> '{scope,edition}'
        AND c."evidenceId"=binding->>'evidenceId' AND c."associationHash"=binding->>'associationHash' AND to_jsonb(c.revision)=binding->'revision'
        AND e.evidence=association AND e."assetId"=NEW."targetId" AND c.xmin::text=(txid_current() % 4294967296)::text)
    THEN RAISE EXCEPTION 'Library Plex receipt requires complete same-transaction exact scoped bindings'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER library_plex_receipt BEFORE INSERT OR UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION media_library_plex_receipt();
