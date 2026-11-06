-- Explicit new pack staging parents record real prepared native members and
-- real staged journal acknowledgments. They grant no serving/publication right.
CREATE INDEX series_pack_staging_attempt ON "Operation" ("targetId")
  WHERE kind IN ('stage_series_pack_members_v1','seal_series_pack_staging_v1');

CREATE FUNCTION media_series_pack_staging_scope_v1(scope JSONB, scope_raw TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE attempt "AcquisitionAttempt"; torrent "Torrent"; leaf_id TEXT; target "MediaIntent"; ids TEXT[]; covered TEXT[];
BEGIN
  PERFORM media_plex_assert_deadline();
  SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=scope->>'attemptId' FOR UPDATE;
  SELECT * INTO STRICT torrent FROM "Torrent" WHERE id=attempt."torrentId" FOR SHARE;
  IF NOT COALESCE(scope->>'schemaVersion'='1' AND scope_raw::jsonb=scope
    AND octet_length(scope_raw) BETWEEN 1 AND 524288
    AND scope->>'operationId'=attempt."coordinatorOperationId" AND scope->>'attemptOperationId'=attempt."operationId"
    AND scope->'recoveryEpoch'=to_jsonb(attempt."recoveryEpoch")
    AND attempt.edition='default' AND attempt."identityEvidence"->'source' ? 'seriesPackV1'
    AND attempt.state NOT IN ('imported','completed','failed','cancelled','obsolete') AND torrent.owned
    AND (scope->>'identityRaw')::jsonb=attempt."identityEvidence"
    AND (((scope->>'observationRaw')::jsonb)-'torrent')=(torrent.observation-'torrent')
    AND ((((scope->>'observationRaw')::jsonb)->'torrent')-ARRAY['ratio','seeding_time','state'])=((torrent.observation->'torrent')-ARRAY['ratio','seeding_time','state'])
    AND (((scope->>'observationRaw')::jsonb)#>>'{torrent,progress}')='1' AND (torrent.observation#>>'{torrent,progress}')='1'
    AND (scope->>'generationsRaw')::jsonb=attempt.generations
    AND encode(sha256(convert_to(scope->>'identityRaw','UTF8')),'hex')=scope->>'identityHash'
    AND encode(sha256(convert_to(scope->>'observationRaw','UTF8')),'hex')=scope->>'observationHash'
    AND encode(sha256(convert_to(scope->>'generationsRaw','UTF8')),'hex')=scope->>'generationsHash'
    AND octet_length(scope->>'identityRaw') BETWEEN 1 AND 262144
    AND octet_length(scope->>'observationRaw') BETWEEN 1 AND 262144
    AND octet_length(scope->>'generationsRaw') BETWEEN 1 AND 32768
    AND jsonb_array_length(scope->'members') BETWEEN 1 AND 100,false)
  THEN RAISE EXCEPTION 'Series pack staging requires its actual complete current attempt and native observation'; END IF;
  SELECT array_agg(id ORDER BY id) INTO ids FROM unnest(attempt."mediaIds") id;
  SELECT array_agg(id ORDER BY id) INTO covered FROM jsonb_array_elements(scope->'members') member, jsonb_array_elements_text(member->'coverage') id;
  IF NOT COALESCE(scope->'coverage'=to_jsonb(ids) AND covered=ids
    AND (SELECT count(DISTINCT member->>'torrentFileIndex') FROM jsonb_array_elements(scope->'members') member)=jsonb_array_length(scope->'members')
    AND (SELECT count(DISTINCT member->>'relativePath') FROM jsonb_array_elements(scope->'members') member)=jsonb_array_length(scope->'members')
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(scope->'members') member WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(torrent.observation->'files') file WHERE file->'index'=member->'torrentFileIndex'
        AND file->>'name'=member->>'relativePath' AND file->>'size'=member->>'sizeBytes' AND file->>'progress'='1'))
    AND EXISTS (SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.mode='active' AND r."ownershipConfirmed" AND r."recoveryEpoch"=attempt."recoveryEpoch"),false)
  THEN RAISE EXCEPTION 'Series pack staging must retain every distinct original covered leaf and actual member'; END IF;
  FOREACH leaf_id IN ARRAY ids LOOP
    SELECT * INTO STRICT target FROM "MediaIntent" WHERE "mediaId"=leaf_id AND edition='default' FOR SHARE;
    IF NOT COALESCE(target."desiredPresence" AND target.monitoring AND target."intentionallyRemovedAt" IS NULL
      AND target."automationEpoch"=attempt."recoveryEpoch" AND attempt.generations->leaf_id=to_jsonb(target.generation),false)
    THEN RAISE EXCEPTION 'Series pack staging current whole-attempt consent changed'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_series_pack_staging_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prepared JSONB; scope JSONB; entry JSONB; member JSONB; ordinal INTEGER := 0; batch INTEGER; count_members INTEGER; attempt "AcquisitionAttempt"; first_parent "Operation";
BEGIN
  prepared := NEW.payload->'prepared'; scope := prepared->'scope'; batch := (prepared->>'batchIndex')::integer;
  PERFORM media_series_pack_staging_scope_v1(scope,NEW.payload->>'scopeRaw');
  SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=scope->>'attemptId';
  count_members := jsonb_array_length(scope->'members');
  IF NOT COALESCE(NEW.kind='stage_series_pack_members_v1' AND NEW."userId" IS NULL AND NEW.status='running' AND NEW.result IS NULL
    AND NEW."targetId"=attempt.id AND attempt."filePlan" IS NULL
    AND NEW."idempotencyKey"='series-pack-staging-v1:'||attempt.id||':'||batch::text
    AND NEW."createdAt">=transaction_timestamp()::timestamp(3) AND NEW."createdAt"<=clock_timestamp()::timestamp(3)
    AND NEW.payload->>'schemaVersion'='1' AND NEW.payload->>'kind'=NEW.kind AND prepared->>'schemaVersion'='1'
    AND octet_length(NEW.payload->>'raw') BETWEEN 1 AND 1048576 AND (NEW.payload->>'raw')::jsonb=prepared
    AND encode(sha256(convert_to(NEW.payload->>'raw','UTF8')),'hex')=NEW.payload->>'preparedHash'
    AND encode(sha256(convert_to(NEW.payload->>'scopeRaw','UTF8')),'hex')=prepared->>'scopeHash'
    AND batch BETWEEN 0 AND 24 AND batch*4<count_members
    AND jsonb_array_length(prepared->'entries')=LEAST(4,count_members-batch*4),false)
  THEN RAISE EXCEPTION 'Series pack staging parent needs its actual bounded prepared native batch'; END IF;
  IF batch>0 THEN
    SELECT * INTO STRICT first_parent FROM "Operation" WHERE "idempotencyKey"='series-pack-staging-v1:'||attempt.id||':0';
    IF NOT COALESCE(first_parent.kind='stage_series_pack_members_v1' AND first_parent.status='completed' AND first_parent."targetId"=attempt.id
      AND (first_parent.payload#>'{prepared,scope}')=scope AND (first_parent.payload#>>'{prepared,scopeHash}')=prepared->>'scopeHash',false)
    THEN RAISE EXCEPTION 'A later series pack batch requires its exact actual completed first ready parent'; END IF;
  END IF;
  FOR entry IN SELECT item FROM jsonb_array_elements(prepared->'entries') item LOOP
    member := scope->'members'->(batch*4+ordinal);
    IF NOT COALESCE(entry->>'libraryKind'='tv' AND entry->'generations'=attempt.generations
      AND entry#>'{identityEvidence,sourceFile,torrentFileIndex}'=member->'torrentFileIndex'
      AND entry#>>'{identityEvidence,sourceFile,relativePath}'=member->>'relativePath'
      AND entry#>>'{identityEvidence,sourceFile,sizeBytes}'=member->>'sizeBytes' AND entry->>'sizeBytes'=member->>'sizeBytes'
      AND (entry->'mediaIds') @> (member->'coverage') AND (member->'coverage') @> (entry->'mediaIds')
      AND jsonb_array_length(entry->'mediaIds')=jsonb_array_length(member->'coverage')
      AND entry->>'checksum' ~ '^[a-f0-9]{64}$',false)
    THEN RAISE EXCEPTION 'Series pack staging descriptor changed its exact prepared source member'; END IF;
    ordinal := ordinal+1;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_staging_birth BEFORE INSERT ON "Operation" FOR EACH ROW WHEN (NEW.kind='stage_series_pack_members_v1') EXECUTE FUNCTION media_series_pack_staging_birth_v1();

CREATE FUNCTION media_series_pack_staging_settlement_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE completed JSONB; prepared JSONB; journal JSONB; manifest JSONB; entry JSONB; ordinal INTEGER := 0;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Series pack staging parent cannot be deleted'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW."targetId" IS DISTINCT FROM OLD."targetId"
    OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR OLD.status<>'running' OR OLD.result IS NOT NULL
  THEN RAISE EXCEPTION 'Series pack prepared parent and completed result are immutable'; END IF;
  prepared := OLD.payload->'prepared'; completed := NEW.result->'completion';
  PERFORM media_series_pack_staging_scope_v1(prepared->'scope',OLD.payload->>'scopeRaw');
  IF NOT COALESCE(NEW.status='completed' AND NEW.result->>'schemaVersion'='1'
    AND octet_length(NEW.result->>'raw') BETWEEN 1 AND 262144 AND (NEW.result->>'raw')::jsonb=completed
    AND encode(sha256(convert_to(NEW.result->>'raw','UTF8')),'hex')=NEW.result->>'completionHash'
    AND completed->>'schemaVersion'='1' AND completed->>'preparedHash'=OLD.payload->>'preparedHash'
    AND jsonb_array_length(completed->'journals')=jsonb_array_length(prepared->'entries'),false)
  THEN RAISE EXCEPTION 'Series pack staging completion requires its actual bounded journal acknowledgments'; END IF;
  FOR journal IN SELECT item FROM jsonb_array_elements(completed->'journals') item LOOP
    entry := prepared->'entries'->ordinal; manifest := (journal->>'raw')::jsonb;
    IF NOT COALESCE(journal->>'path'='journal/'||(entry->>'operationId')||'.json'
      AND octet_length(journal->>'raw') BETWEEN 1 AND 32768
      AND encode(sha256(convert_to(journal->>'raw','UTF8')),'hex')=journal->>'sha256'
      AND manifest->>'operationId'=entry->>'operationId' AND manifest->>'kind'='import' AND manifest->>'phase'='staged'
      AND manifest->>'sha256'=entry->>'checksum' AND manifest->'previousSha256'=entry->'previousChecksum',false)
    THEN RAISE EXCEPTION 'Series pack staging journal differs from its actual native descriptor'; END IF;
    ordinal := ordinal+1;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_staging_settlement BEFORE UPDATE OR DELETE ON "Operation" FOR EACH ROW WHEN (OLD.kind='stage_series_pack_members_v1') EXECUTE FUNCTION media_series_pack_staging_settlement_v1();

CREATE FUNCTION media_series_pack_staging_seal_birth_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE seal JSONB; scope JSONB; attempt "AcquisitionAttempt"; reference JSONB; parent "Operation"; ordinal INTEGER := 0; plan JSONB := '[]'::jsonb;
BEGIN
  seal := NEW.payload->'seal'; scope := seal->'scope';
  PERFORM media_series_pack_staging_scope_v1(scope,NEW.payload->>'scopeRaw');
  SELECT * INTO STRICT attempt FROM "AcquisitionAttempt" WHERE id=scope->>'attemptId';
  IF NOT COALESCE(NEW.kind='seal_series_pack_staging_v1' AND NEW.status='completed' AND NEW."userId" IS NULL AND NEW.result IS NULL
    AND NEW."targetId"=attempt.id AND NEW."idempotencyKey"='series-pack-staging-seal-v1:'||attempt.id
    AND NEW."createdAt">=transaction_timestamp()::timestamp(3) AND NEW."createdAt"<=clock_timestamp()::timestamp(3)
    AND NEW.payload->>'schemaVersion'='1' AND NEW.payload->>'kind'=NEW.kind AND seal->>'schemaVersion'='1'
    AND seal->>'attemptId'=attempt.id AND seal->>'operationId'=attempt."coordinatorOperationId"
    AND octet_length(NEW.payload->>'raw') BETWEEN 1 AND 1048576 AND (NEW.payload->>'raw')::jsonb=seal
    AND encode(sha256(convert_to(NEW.payload->>'raw','UTF8')),'hex')=NEW.payload->>'sealHash'
    AND encode(sha256(convert_to(NEW.payload->>'scopeRaw','UTF8')),'hex')=seal->>'scopeHash'
    AND octet_length(NEW.payload->>'filePlanRaw') BETWEEN 1 AND 1048576 AND (NEW.payload->>'filePlanRaw')::jsonb=attempt."filePlan"
    AND encode(sha256(convert_to(NEW.payload->>'filePlanRaw','UTF8')),'hex')=seal->>'filePlanHash'
    AND jsonb_array_length(seal->'receipts')=(jsonb_array_length(scope->'members')+3)/4
    AND (SELECT count(*) FROM "Operation" p WHERE p.kind='stage_series_pack_members_v1' AND p."targetId"=attempt.id)=jsonb_array_length(seal->'receipts'),false)
  THEN RAISE EXCEPTION 'Series pack staging seal requires every actual completed native batch'; END IF;
  FOR reference IN SELECT item FROM jsonb_array_elements(seal->'receipts') item LOOP
    SELECT * INTO STRICT parent FROM "Operation" WHERE id=reference->>'operationId';
    IF NOT COALESCE(parent.kind='stage_series_pack_members_v1' AND parent.status='completed' AND parent."targetId"=attempt.id
      AND parent.payload#>'{prepared,scope}'=scope AND parent.payload#>>'{prepared,scopeHash}'=seal->>'scopeHash'
      AND (parent.payload#>>'{prepared,batchIndex}')::integer=ordinal AND (reference->>'batchIndex')::integer=ordinal
      AND parent.payload->>'preparedHash'=reference->>'preparedHash' AND parent.result->>'completionHash'=reference->>'completionHash',false)
    THEN RAISE EXCEPTION 'Series pack staging seal omitted or changed a complete original member batch'; END IF;
    plan := plan || (parent.payload#>'{prepared,entries}'); ordinal := ordinal+1;
  END LOOP;
  IF plan IS DISTINCT FROM attempt."filePlan" THEN RAISE EXCEPTION 'Series pack seal differs from the original complete FilePlan'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_staging_seal_birth BEFORE INSERT ON "Operation" FOR EACH ROW WHEN (NEW.kind='seal_series_pack_staging_v1') EXECUTE FUNCTION media_series_pack_staging_seal_birth_v1();

CREATE FUNCTION media_series_pack_staging_seal_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Series pack complete staging seal is immutable'; END;
$$;
CREATE TRIGGER series_pack_staging_seal_immutable BEFORE UPDATE OR DELETE ON "Operation" FOR EACH ROW WHEN (OLD.kind='seal_series_pack_staging_v1') EXECUTE FUNCTION media_series_pack_staging_seal_immutable_v1();

CREATE FUNCTION media_series_pack_staging_no_outbox_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Operation" p WHERE p.id=NEW."operationId" AND p.kind IN ('stage_series_pack_members_v1','seal_series_pack_staging_v1'))
  THEN RAISE EXCEPTION 'Series pack staging parents cannot dispatch a Workflow'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_pack_staging_no_outbox BEFORE INSERT OR UPDATE ON "OutboxCommand" FOR EACH ROW EXECUTE FUNCTION media_series_pack_staging_no_outbox_v1();
