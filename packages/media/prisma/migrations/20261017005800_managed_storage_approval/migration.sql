-- Owner activation is the first durable storage approval for a managed-only library.
-- Existing legacy/native receipt graphs and restore quiescence policy stay intact.
CREATE FUNCTION media_managed_storage_approval_v1(p_ref jsonb,p_roots jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_event "ApplicationEvent"; v_approval jsonb; v_root jsonb;
BEGIN
  SELECT * INTO STRICT v_event FROM "ApplicationEvent" WHERE id=p_ref->>'id';
  v_approval:=v_event.payload->'approval';
  IF NOT COALESCE(v_event.kind='managed_storage_approval_v1' AND p_ref->>'kind'='managed'
    AND v_event."actorId"=v_approval->>'actorId'
    AND v_event."dedupeKey"='managed-storage:'||(v_approval->>'recoveryEpoch')||':'||(v_approval->>'runtimeVersion')
    AND v_approval->'schemaVersion'='1'::jsonb
    AND v_event.payload->>'approvalHash'=p_ref->>'planHash'
    AND encode(sha256(convert_to(v_event.payload->>'raw','UTF8')),'hex')=p_ref->>'planHash'
    AND (v_event.payload->>'raw')::jsonb=v_approval
    AND v_approval#>>'{mounts,configurationDigest}'='17c2f2a23f0f71e7e4b264d643e598f728bd9f12d1225376646a99a3f2c34ad3'
    AND jsonb_array_length(v_approval#>'{mounts,mounts}')=2,false)
  THEN RAISE EXCEPTION 'Managed storage original owner approval changed'; END IF;
  FOR v_root IN SELECT r.value FROM jsonb_array_elements(p_roots) r WHERE r.value->'receipt'=p_ref LOOP
    IF (SELECT count(*) FROM jsonb_array_elements(v_approval#>'{mounts,mounts}') m WHERE
      m.value->>'root'=v_root->>'rootPath' AND m.value->>'pvcUid'=v_root->>'pvcUid'
      AND m.value->>'volumeName'=v_root->>'volumeName' AND m.value->>'volumePath'=v_root->>'volumePath')<>1
    THEN RAISE EXCEPTION 'Managed storage differs from its original approved physical root'; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION media_managed_storage_approval_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_runtime "MediaRuntimeState"; v_root "MediaStorageAuthority"; v_approval jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind='managed_storage_approval_v1' THEN RAISE EXCEPTION 'Managed storage owner approval is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND (OLD.kind='managed_storage_approval_v1' OR NEW.kind='managed_storage_approval_v1') THEN
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Managed storage owner approval is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind<>'managed_storage_approval_v1' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT v_runtime FROM "MediaRuntimeState" WHERE id='singleton' FOR SHARE;
  v_approval:=NEW.payload->'approval';
  IF NOT COALESCE(NEW."mediaId" IS NULL AND NEW."actorId"=v_approval->>'actorId'
    AND EXISTS(SELECT 1 FROM "MediaUser" u WHERE u.id=NEW."actorId" AND u.role='owner' AND NOT u.restricted)
    AND v_runtime.mode='active' AND v_runtime."ownershipConfirmed"
    AND EXISTS(SELECT 1 FROM "MediaRuntimeState" r WHERE r.id='singleton' AND r.xmin::text=(txid_current()%4294967296)::text)
    AND v_approval->'schemaVersion'='1'::jsonb
    AND v_approval->'recoveryEpoch'=to_jsonb(v_runtime."recoveryEpoch")
    AND v_approval->'runtimeVersion'=to_jsonb(v_runtime.version)
    AND NEW."dedupeKey"='managed-storage:'||v_runtime."recoveryEpoch"::text||':'||v_runtime.version::text
    AND NOT EXISTS(SELECT 1 FROM "MediaHandoffReceipt")
    AND NEW.payload ?& ARRAY['approval','raw','approvalHash']
    AND NEW.payload-ARRAY['approval','raw','approvalHash']='{}'::jsonb
    AND v_approval ?& ARRAY['schemaVersion','actorId','recoveryEpoch','runtimeVersion','mounts']
    AND v_approval-ARRAY['schemaVersion','actorId','recoveryEpoch','runtimeVersion','mounts']='{}'::jsonb
    AND encode(sha256(convert_to(NEW.payload->>'raw','UTF8')),'hex')=NEW.payload->>'approvalHash'
    AND (NEW.payload->>'raw')::jsonb=v_approval,false)
  THEN RAISE EXCEPTION 'Managed storage approval requires its exact current owner activation'; END IF;
  -- The runtime helper enforces all current epoch, pod, expiry, config and tuple checks.
  PERFORM * FROM media_runtime_proof_v1();
  IF (SELECT count(*) FROM "MediaStorageAuthority")<>2
  THEN RAISE EXCEPTION 'Managed approval requires exactly both current physical roots'; END IF;
  FOR v_root IN SELECT * FROM "MediaStorageAuthority" LOOP
    IF v_root.evidence->>'kind' IS DISTINCT FROM 'canonical_storage'
      OR v_root.evidence IS DISTINCT FROM v_approval->'mounts'
    THEN RAISE EXCEPTION 'Managed approval must capture actual canonical storage evidence'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER managed_storage_approval_immutable_v1 BEFORE INSERT OR UPDATE OR DELETE ON "ApplicationEvent"
FOR EACH ROW EXECUTE FUNCTION media_managed_storage_approval_immutable_v1();

CREATE OR REPLACE FUNCTION media_runtime_proof_v1()
RETURNS TABLE (
  id text,
  "recoveryEpoch" integer,
  "observedAt" timestamp,
  "expiresAt" timestamp,
  "revokedAt" timestamp
) LANGUAGE plpgsql AS $$
DECLARE
  v_runtime "MediaRuntimeState";
  v_roots "MediaStorageAuthority"[];
  v_root "MediaStorageAuthority";
  v_mount jsonb;
  v_evidence jsonb;
  v_approved jsonb;
  v_ref jsonb;
  v_worker text;
  v_observed timestamp;
  v_expires timestamp;
  v_now timestamp := clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  SELECT r.* INTO STRICT v_runtime FROM "MediaRuntimeState" r WHERE r.id='singleton' FOR SHARE;
  IF v_runtime.mode<>'active' OR NOT v_runtime."ownershipConfirmed"
  THEN RAISE EXCEPTION 'Media runtime is not active'; END IF;

  SELECT array_agg(s ORDER BY s."rootPath") INTO v_roots
    FROM "MediaStorageAuthority" s WHERE s."rootPath" IN ('/data/movies','/data/tv');

  -- A malformed restored envelope is never permission to select the old lease.
  FOR v_root IN SELECT s.* FROM unnest(v_roots) s WHERE s.evidence->>'kind'='native_restore' LOOP
    v_approved:=v_root.evidence->'approvedRoots';
    IF jsonb_typeof(v_approved) IS DISTINCT FROM 'array'
      OR v_root.evidence->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    THEN RAISE EXCEPTION 'Restored storage approval envelope is malformed'; END IF;
    IF jsonb_array_length(v_approved)<>2
      OR (SELECT count(DISTINCT a.value->>'rootPath') FROM jsonb_array_elements(v_approved) a WHERE a.value->>'rootPath' IN ('/data/movies','/data/tv'))<>2
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_approved) a WHERE NOT COALESCE(
        length(a.value->>'pvcUid')>0 AND length(a.value->>'volumeName')>0
        AND jsonb_typeof(a.value->'volumePath')='string'
        AND a.value#>>'{receipt,kind}' IN ('legacy','native','managed')
        AND a.value#>>'{receipt,id}' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        AND a.value#>>'{receipt,planHash}' ~ '^[a-f0-9]{64}$',false))
    THEN RAISE EXCEPTION 'Restored storage approval roots are malformed'; END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM unnest(v_roots) s WHERE s.evidence->>'kind'='canonical_storage' OR (s.evidence->>'kind'='native_restore' AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.evidence->'approvedRoots') a WHERE a.value#>>'{receipt,kind}'='managed'))
  ) THEN
    IF cardinality(v_roots)<>2
    THEN RAISE EXCEPTION 'Media runtime requires both canonical storage roots'; END IF;
    FOREACH v_root IN ARRAY v_roots LOOP
      v_evidence:=v_root.evidence;
      IF v_evidence->>'kind'='native_restore' THEN
        IF v_evidence->'schemaVersion' IS DISTINCT FROM '1'::jsonb
        THEN RAISE EXCEPTION 'Managed restored storage schema changed'; END IF;
        v_approved:=v_evidence->'approvedRoots';
        IF NOT COALESCE(jsonb_array_length(v_approved)=2
          AND (SELECT count(DISTINCT a.value->>'rootPath') FROM jsonb_array_elements(v_approved) a)=2
          AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_approved) a WHERE a.value#>>'{receipt,kind}' IS DISTINCT FROM 'managed')
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_approved) a WHERE a.value->>'rootPath'=v_root."rootPath"
            AND a.value->>'pvcUid'=v_root."pvcUid" AND a.value->>'volumeName'=v_root."volumeName" AND a.value->>'volumePath'=v_root."volumePath"),false)
        THEN RAISE EXCEPTION 'Managed restored storage lost its approved physical roots'; END IF;
        FOR v_ref IN SELECT DISTINCT a.value->'receipt' FROM jsonb_array_elements(v_approved) a LOOP
          PERFORM media_managed_storage_approval_v1(v_ref,v_approved);
        END LOOP;
        v_evidence:=v_evidence->'mounts';
      END IF;
      IF NOT COALESCE(v_evidence->>'kind'='canonical_storage'
        AND v_evidence->>'schemaVersion'='1' AND v_evidence->>'namespace'='media'
        AND v_root."recoveryEpoch"=v_runtime."recoveryEpoch" AND v_root."revokedAt" IS NULL
        AND v_root."observedAt"<=v_now AND v_root."expiresAt">v_now
        AND v_root."expiresAt">v_root."observedAt"
        AND v_root."expiresAt"-v_root."observedAt"<=interval '120 seconds'
        AND ((v_evidence->>'capturedAt')::timestamptz AT TIME ZONE 'UTC')=v_root."observedAt"
        AND ((v_evidence->>'expiresAt')::timestamptz AT TIME ZONE 'UTC')=v_root."expiresAt"
        -- snapshotHash(LEGACY_OBSERVER_CONFIG); the SQL parity regression detects config drift.
        AND v_evidence->>'configurationDigest'='17c2f2a23f0f71e7e4b264d643e598f728bd9f12d1225376646a99a3f2c34ad3'
        AND jsonb_array_length(v_evidence->'mounts')=2, false)
      THEN RAISE EXCEPTION 'Media runtime storage proof is missing, changed or expired'; END IF;
      SELECT m.value INTO STRICT v_mount
        FROM jsonb_array_elements(v_evidence->'mounts') m WHERE m.value->>'root'=v_root."rootPath";
      IF NOT COALESCE(v_mount->>'deployment'='media-media-files'
        AND v_mount->>'container'='media-files' AND v_mount->>'readOnly'='false'
        AND v_mount->>'pvcUid'=v_root."pvcUid" AND v_mount->>'volumeName'=v_root."volumeName"
        AND v_mount->>'volumePath'=v_root."volumePath" AND v_mount->>'podUid'=v_root."workerPodUid"
        AND length(v_root."workerPodUid")>0
        AND (v_worker IS NULL OR v_worker=v_root."workerPodUid"),false)
      THEN RAISE EXCEPTION 'Media runtime canonical storage identity changed'; END IF;
      v_worker:=v_root."workerPodUid";
      v_observed:=GREATEST(v_observed,v_root."observedAt");
      v_expires:=LEAST(v_expires,v_root."expiresAt");
    END LOOP;
    RETURN QUERY SELECT 'singleton'::text,v_runtime."recoveryEpoch",v_observed,v_expires,NULL::timestamp;
    RETURN;
  END IF;

  RETURN QUERY SELECT l.id,l."recoveryEpoch",l."observedAt",l."expiresAt",l."revokedAt"
    FROM "LegacyWriterLease" l WHERE l.id='singleton'
    AND l."recoveryEpoch"=v_runtime."recoveryEpoch" AND l."revokedAt" IS NULL
    AND l."observedAt"<=v_now AND l."expiresAt">v_now
    AND l."expiresAt"-l."observedAt"<=interval '120 seconds';
  IF NOT FOUND THEN RAISE EXCEPTION 'Media runtime writer proof is missing or expired'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION media_series_pack_native_storage_original_v1(p_scope jsonb,p_configuration_digest text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ref jsonb; v_root jsonb; v_receipt jsonb; v_plan jsonb; v_network jsonb; v_mounts jsonb; v_kind text;
BEGIN
  FOR v_ref IN SELECT DISTINCT r.value->'receipt' FROM jsonb_array_elements(p_scope->'storageRoots') r LOOP
    v_kind:=v_ref->>'kind';
    IF v_kind='managed' THEN
      PERFORM media_managed_storage_approval_v1(v_ref,p_scope->'storageRoots');
      IF p_configuration_digest IS DISTINCT FROM '17c2f2a23f0f71e7e4b264d643e598f728bd9f12d1225376646a99a3f2c34ad3'
      THEN RAISE EXCEPTION 'Native pack prior managed storage configuration changed'; END IF;
      CONTINUE;
    END IF;
    IF v_kind='legacy' THEN
      SELECT to_jsonb(r) INTO STRICT v_receipt FROM "MediaHandoffReceipt" r WHERE r.id=v_ref->>'id';
      SELECT to_jsonb(p) INTO STRICT v_plan FROM "MediaHandoffPlan" p WHERE p.id=v_receipt->>'planId';
    ELSIF v_kind='native' THEN
      SELECT to_jsonb(r) INTO STRICT v_receipt FROM "NativeRecoveryReceipt" r WHERE r.id=v_ref->>'id';
      SELECT to_jsonb(p) INTO STRICT v_plan FROM "NativeRecoveryPlan" p WHERE p.id=v_receipt->>'planId';
    ELSE RAISE EXCEPTION 'Native pack storage requires an actual known owner approval kind'; END IF;
    IF NOT COALESCE(v_receipt->>'planHash'=v_ref->>'planHash' AND v_plan->>'planHash'=v_ref->>'planHash'
      AND v_receipt->>'planId'=v_plan->>'id' AND v_plan->>'state'='applied'
      AND v_receipt->'recoveryEpoch'=v_plan->'recoveryEpoch' AND v_plan->'plan'<>'null'::jsonb,false)
    THEN RAISE EXCEPTION 'Native pack storage prior approval changed or was never applied'; END IF;
    v_network:=v_receipt#>'{selection,networkEvidence}';
    IF v_kind='legacy' THEN
      IF v_network->>'configurationDigest' IS DISTINCT FROM p_configuration_digest
      THEN RAISE EXCEPTION 'Native pack prior storage configuration changed'; END IF;
      v_mounts:=v_network->'mounts';
    ELSE
      IF jsonb_typeof(v_network->'mounts')='object' THEN
        IF v_network#>>'{mounts,configurationDigest}' IS DISTINCT FROM p_configuration_digest
        THEN RAISE EXCEPTION 'Native pack prior native storage configuration changed'; END IF;
        v_mounts:=v_network#>'{mounts,mounts}';
      ELSE
        IF v_network->>'configurationDigest' IS DISTINCT FROM p_configuration_digest
        THEN RAISE EXCEPTION 'Native pack prior native storage configuration changed'; END IF;
        v_mounts:=v_network->'mounts';
      END IF;
    END IF;
    FOR v_root IN SELECT r.value FROM jsonb_array_elements(p_scope->'storageRoots') r WHERE r.value->'receipt'=v_ref LOOP
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_mounts) m WHERE
        (CASE WHEN v_kind='legacy' THEN m.value->'canonical' ELSE m.value END)->>'root'=v_root->>'rootPath'
        AND (CASE WHEN v_kind='legacy' THEN m.value->'canonical' ELSE m.value END)->>'pvcUid'=v_root->>'pvcUid'
        AND (CASE WHEN v_kind='legacy' THEN m.value->'canonical' ELSE m.value END)->>'volumeName'=v_root->>'volumeName'
        AND (CASE WHEN v_kind='legacy' THEN m.value->'canonical' ELSE m.value END)->>'volumePath'=v_root->>'volumePath')
      THEN RAISE EXCEPTION 'Native pack current storage identity lacks its actual original approved mount'; END IF;
    END LOOP;
  END LOOP;
END;
$$;

