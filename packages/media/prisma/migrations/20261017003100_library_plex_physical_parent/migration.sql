-- Retain the literal v2 parent contract; v3 proves its actual metadata checkpoints separately.
CREATE FUNCTION media_movie_subtitle_library_parent_v3(proof JSONB, asset "LibraryAsset", scope JSONB) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE receipt "MediaHandoffReceipt"; plan "MediaHandoffPlan"; baseline JSONB; change JSONB; edit JSONB;
  before_network JSONB; after_network JSONB; expected_label TEXT;
BEGIN
  SELECT * INTO STRICT receipt FROM "MediaHandoffReceipt" WHERE id=proof->>'receiptId';
  IF receipt.selection->'schemaVersion'<>'3'::jsonb THEN
    RETURN false;
  END IF;
  SELECT * INTO STRICT plan FROM "MediaHandoffPlan" WHERE id=receipt."planId";
  IF (SELECT count(*) FROM jsonb_array_elements(receipt.selection->'assets') a WHERE a->>'id'=asset.id)<>1 THEN RETURN false; END IF;
  SELECT a INTO STRICT baseline FROM jsonb_array_elements(receipt.selection->'assets') a WHERE a->>'id'=asset.id;
  before_network := plan.plan->'network'; after_network := receipt.selection->'networkEvidence';
  IF NOT COALESCE(plan.state='applied' AND plan.id=proof->>'planId' AND plan."planHash"=receipt."planHash"
    AND proof->>'planHash'=receipt."planHash" AND plan.scope->'schemaVersion'='3'::jsonb
    AND plan.plan->'schemaVersion'='3'::jsonb AND receipt.selection->'scope'=plan.scope
    AND receipt.selection->'fileEvidence'=plan.plan->'files'
    AND before_network-'plex'=after_network-'plex'
    AND (SELECT jsonb_agg(p-'editionTitle' ORDER BY n) FROM jsonb_array_elements(before_network->'plex') WITH ORDINALITY a(p,n))
      =(SELECT jsonb_agg(p-'editionTitle' ORDER BY n) FROM jsonb_array_elements(after_network->'plex') WITH ORDINALITY a(p,n))
    AND receipt."previousRuntimeVersion"=plan."runtimeVersion" AND receipt."runtimeVersion"=receipt."previousRuntimeVersion"+1
    AND receipt."recoveryEpoch"=plan."recoveryEpoch" AND receipt."recoveryEpoch"=asset."ownershipEpoch"
    AND baseline->'schemaVersion'='2'::jsonb AND baseline->'scope'=scope AND baseline->'owned'='true'::jsonb
    AND baseline->'version'='0'::jsonb AND asset.version=0 AND baseline->>'state'='published'
    AND baseline->>'path'=asset.path AND baseline->>'checksum'=asset.checksum AND baseline->>'edition'=asset.edition
    AND baseline->>'editionRootId'=asset."editionRootId" AND baseline->'ownershipEpoch'=to_jsonb(asset."ownershipEpoch")
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(receipt.selection #> '{scope,files}') f WHERE f->>'assetId'=asset.id
      AND f->>'libraryKind'='movies' AND f->>'edition'=asset.edition AND f->>'canonicalPath'=asset.path
      AND f->'existingAssetId'='null'::jsonb AND f->'classification'<>'null'::jsonb)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(receipt.selection #> '{fileEvidence,files}') f
      WHERE f->>'assetId'=asset.id AND f->>'canonicalPath'=asset.path AND f->>'checksum'=asset.checksum)
    AND jsonb_array_length(receipt.selection->'plexEdits')=jsonb_array_length(plan.plan->'plexEdits'),false)
  THEN RETURN false; END IF;
  FOR change IN SELECT c FROM jsonb_array_elements(plan.plan->'plexEdits') c LOOP
    IF (SELECT count(*) FROM jsonb_array_elements(receipt.selection->'plexEdits') e WHERE e->'change'=change)<>1 THEN RETURN false; END IF;
    SELECT e INTO STRICT edit FROM jsonb_array_elements(receipt.selection->'plexEdits') e WHERE e->'change'=change;
    IF NOT EXISTS (SELECT 1 FROM "MediaHandoffObservation" c WHERE c.id=edit #>> '{completion,id}'
      AND c."planId"=plan.id AND c.kind='plex_edit_completion_v1' AND c."evidenceHash"=edit #>> '{completion,evidenceHash}'
      AND c.evidence=edit #> '{completion,evidence}') THEN RETURN false; END IF;
    IF edit->'intent'<>'null'::jsonb AND NOT EXISTS (SELECT 1 FROM "MediaHandoffObservation" i
      WHERE i.id=edit #>> '{intent,id}' AND i."planId"=plan.id AND i.kind='plex_edit_intent_v1'
        AND i."evidenceHash"=edit #>> '{intent,evidenceHash}' AND i.evidence=edit #> '{intent,evidence}') THEN RETURN false; END IF;
  END LOOP;
  expected_label := CASE asset.edition WHEN 'default' THEN '' WHEN 'theatrical_cut' THEN 'Theatrical Cut'
    WHEN 'directors_cut' THEN 'Director''s Cut' WHEN 'extended_cut' THEN 'Extended Cut' WHEN 'final_cut' THEN 'Final Cut'
    WHEN 'unrated_cut' THEN 'Unrated Cut' WHEN 'uncut_version' THEN 'Uncut Version' ELSE NULL END;
  RETURN COALESCE(expected_label IS NOT NULL AND (SELECT count(*)=1 FROM jsonb_array_elements(after_network->'plex') p
    WHERE p->>'assetId'=asset.id AND p->>'mediaId'=asset."editionRootId" AND p->>'edition'=asset.edition
      AND p->>'canonicalPath'=asset.path AND COALESCE(p->>'editionTitle','')=expected_label),false);
END;
$$;

CREATE OR REPLACE FUNCTION media_movie_subtitle_parent(proof JSONB, asset "LibraryAsset", scope JSONB) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE publication "MediaPublicationTransition"; receipt "MediaHandoffReceipt"; plan "MediaHandoffPlan"; baseline JSONB;
BEGIN
  IF proof->>'kind'='movie_publication_transition_v2' THEN
    SELECT * INTO STRICT publication FROM "MediaPublicationTransition" WHERE id=proof->>'transitionId';
    RETURN COALESCE(publication.intent->'schemaVersion'='2'::jsonb AND publication.intent->'scope'=scope
      AND publication.outcome->>'kind'='published' AND publication.outcome #>> '{entries,0,successor,id}'=asset.id
      AND publication.outcome #>> '{entries,0,successor,checksum}'=asset.checksum
      AND proof->>'intentHash'=publication."intentHash" AND proof->>'outcomeHash'=publication."outcomeHash",false);
  ELSIF proof->>'kind'='movie_library_adoption_v2' THEN
    SELECT * INTO STRICT receipt FROM "MediaHandoffReceipt" WHERE id=proof->>'receiptId';
    IF receipt.selection->'schemaVersion'='3'::jsonb THEN
      RETURN media_movie_subtitle_library_parent_v3(proof,asset,scope);
    END IF;
    SELECT * INTO STRICT plan FROM "MediaHandoffPlan" WHERE id=receipt."planId";
    IF (SELECT count(*) FROM jsonb_array_elements(receipt.selection->'assets') item WHERE item->>'id'=asset.id) <> 1 THEN RETURN false; END IF;
    SELECT item INTO STRICT baseline FROM jsonb_array_elements(receipt.selection->'assets') item WHERE item->>'id'=asset.id;
    RETURN COALESCE(plan.state='applied' AND plan.id=proof->>'planId' AND plan."planHash"=receipt."planHash" AND proof->>'planHash'=receipt."planHash"
      AND plan.scope->'schemaVersion'='2'::jsonb AND plan.plan->'schemaVersion'='2'::jsonb
      AND receipt.selection->'schemaVersion'='2'::jsonb AND receipt.selection->'scope'=plan.scope
      AND receipt.selection->'fileEvidence'=plan.plan->'files' AND receipt.selection->'networkEvidence'=plan.plan->'network'
      AND receipt."previousRuntimeVersion"=plan."runtimeVersion" AND receipt."runtimeVersion"=receipt."previousRuntimeVersion"+1
      AND receipt."recoveryEpoch"=plan."recoveryEpoch" AND receipt."recoveryEpoch"=asset."ownershipEpoch"
      AND baseline->'schemaVersion'='2'::jsonb AND baseline->'scope'=scope AND baseline->'owned'='true'::jsonb
      AND baseline->'version'='0'::jsonb AND asset.version=0 AND baseline->>'state'='published'
      AND baseline->>'path'=asset.path AND baseline->>'checksum'=asset.checksum AND baseline->>'edition'=asset.edition
      AND baseline->>'editionRootId'=asset."editionRootId" AND baseline->'ownershipEpoch'=to_jsonb(asset."ownershipEpoch")
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(receipt.selection #> '{scope,files}') item
        WHERE item->>'assetId'=asset.id AND item->>'libraryKind'='movies' AND item->>'edition'=asset.edition
          AND item->>'canonicalPath'=asset.path AND item->'existingAssetId'='null'::jsonb AND item->'classification'<>'null'::jsonb)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(receipt.selection #> '{fileEvidence,files}') item
        WHERE item->>'assetId'=asset.id AND item->>'canonicalPath'=asset.path AND item->>'checksum'=asset.checksum),false);
  END IF;
  RETURN false;
END;
$$;
