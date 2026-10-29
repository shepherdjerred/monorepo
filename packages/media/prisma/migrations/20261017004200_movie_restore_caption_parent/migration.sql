-- A restored physical version is neither an acquisition nor a rewritten adoption.
CREATE FUNCTION media_movie_subtitle_restore_parent_v1(proof JSONB, asset "LibraryAsset", scope JSONB) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE operation "Operation"; envelope JSONB; receipt JSONB; baseline JSONB;
BEGIN
  SELECT * INTO STRICT operation FROM "Operation" WHERE id=proof->>'operationId';
  envelope := operation.result->'movieRestoreReceiptV1';
  receipt := envelope->'receipt';
  baseline := receipt->'after';
  RETURN COALESCE(operation.kind='restore_movie_edition_v4' AND operation."targetId"=asset."editionRootId"
    AND envelope->>'receiptHash'=proof->>'receiptHash' AND receipt->'schemaVersion'='1'::jsonb
    AND receipt->'scope'=scope AND receipt #> '{input,scope}'=scope AND operation.payload->'scope'=scope
    AND receipt #>> '{input,operationId}'=operation.id AND proof->'scope'=scope
    AND proof->>'assetId'=asset.id AND proof->'assetVersion'=to_jsonb(asset.version)
    AND baseline->'schemaVersion'='2'::jsonb AND baseline->'scope'=scope
    AND baseline->>'id'=asset.id AND baseline->'version'=to_jsonb(asset.version)
    AND baseline->>'state'='published' AND asset.state='published' AND asset.owned
    AND baseline->'owned'='true'::jsonb AND baseline->>'checksum'=asset.checksum
    AND baseline->>'path'=asset.path AND baseline->>'sizeBytes'=asset."sizeBytes"::text
    AND baseline->>'edition'=asset.edition AND baseline->>'editionRootId'=asset."editionRootId"
    AND baseline->'ownershipEpoch'=to_jsonb(asset."ownershipEpoch")
    AND proof->>'bindingHash' ~ '^[a-f0-9]{64}$' AND proof->>'physicalEvidenceHash' ~ '^[a-f0-9]{64}$',false);
END;
$$;

-- Existing acquisition and adoption branches retain their original conditions.
CREATE OR REPLACE FUNCTION media_movie_subtitle_parent(proof JSONB, asset "LibraryAsset", scope JSONB) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE publication "MediaPublicationTransition"; receipt "MediaHandoffReceipt"; plan "MediaHandoffPlan"; baseline JSONB;
BEGIN
  IF proof->>'kind'='movie_publication_transition_v2' THEN
    SELECT * INTO STRICT publication FROM "MediaPublicationTransition" WHERE id=proof->>'transitionId';
    RETURN COALESCE(publication.intent->'schemaVersion'='2'::jsonb AND publication.intent->'scope'=scope
      AND publication.outcome->>'kind'='published' AND publication.outcome #>> '{entries,0,successor,id}'=asset.id
      AND publication.outcome #>> '{entries,0,successor,checksum}'=asset.checksum
      AND proof->>'intentHash'=publication."intentHash" AND proof->>'outcomeHash'=publication."outcomeHash",false);
  ELSIF proof->>'kind'='movie_restore_publication_v1' THEN
    RETURN media_movie_subtitle_restore_parent_v1(proof,asset,scope);
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
