BEGIN;

LOCK TABLE "MatchNotificationIntent", "ScoutTemporalWork", "MatchProcessingReceipt"
IN SHARE ROW EXCLUSIVE MODE;

-- The economy tables are gone. Retire their terminal delivery/work metadata
-- before removing those variants from the application's closed contracts.
CREATE TEMP TABLE retired_economy_intents ON COMMIT DROP AS
SELECT "intentKey", "state" FROM "MatchNotificationIntent"
WHERE "kind" = 'settlement'
   OR ("kind" = 'product-announcement'
       AND "payload"::jsonb #>> '{data,announcement,data,effect,kind}' = 'weekly-bucks');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM retired_economy_intents
             WHERE "state" NOT IN ('delivered', 'expired', 'suppressed', 'permission-denied'))
     OR EXISTS (SELECT 1 FROM "ScoutTemporalWork"
                WHERE "kind" = 'parlay-generation' AND "state" IN ('queued', 'running')) THEN
    RAISE EXCEPTION 'Retired economy work is not terminal';
  END IF;

  -- Keep the idempotency receipt and Dare identities, but discard monetary
  -- evidence. Refuse unknown/corrupt receipts rather than inventing evidence.
  IF EXISTS (
    SELECT 1 FROM "MatchProcessingReceipt"
    WHERE "kind" = 'settlement' AND (
      "evidence" IS NULL
      OR "evidence"::jsonb ->> 'kind' IS DISTINCT FROM 'settlement-evidence'
      OR ("evidence"::jsonb -> 'version') IS NULL
      OR ("evidence"::jsonb -> 'version') NOT IN ('1'::jsonb, '2'::jsonb)
      OR jsonb_typeof("evidence"::jsonb #> '{data,resolvedDareIds}') IS DISTINCT FROM 'array'
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof("evidence"::jsonb #> '{data,resolvedDareIds}') = 'array'
            THEN "evidence"::jsonb #> '{data,resolvedDareIds}' ELSE '[]'::jsonb END
        ) AS ids(value)
        WHERE jsonb_typeof(value) <> 'number'
           OR value::text !~ '^[1-9][0-9]*$'
           OR CASE WHEN jsonb_typeof(value) = 'number'
                THEN value::text::numeric > 9007199254740991 ELSE false END
      )
    )
  ) THEN
    RAISE EXCEPTION 'Invalid retained Dare settlement evidence';
  END IF;
END $$;

DELETE FROM "NotificationPresentation" presentation
USING retired_economy_intents retired
WHERE presentation."intentKey" = retired."intentKey";

DELETE FROM "ScoutWorkflowStart"
WHERE "inputPayload"::jsonb #>> '{data,intentKey}' IN
        (SELECT "intentKey" FROM retired_economy_intents)
   OR "inputPayload"::jsonb #>> '{data,kind}' IN
        ('parlay-generation', 'bucks-reconciliation', 'weekly-bucks-leaderboard');

DELETE FROM "MatchNotificationIntent" intent
USING retired_economy_intents retired
WHERE intent."intentKey" = retired."intentKey";

DELETE FROM "MatchProcessingReceipt"
WHERE "kind" IN ('prematch-markets', 'v2-notification-render-settlement');

UPDATE "MatchProcessingReceipt"
SET "evidence" = jsonb_build_object(
  'kind', 'settlement-evidence', 'version', 2,
  'data', jsonb_build_object('resolvedDareIds', "evidence"::jsonb #> '{data,resolvedDareIds}')
)::text
WHERE "kind" = 'settlement' AND "evidence"::jsonb -> 'version' = '1'::jsonb;

DELETE FROM "ScoutTemporalWork" WHERE "kind" = 'parlay-generation';
DELETE FROM "DmAuditLog"
WHERE "kind" IN ('betting_settlement_receipt', 'betting_player_bet_outcome');
DELETE FROM "FeatureTipImpression" WHERE "tipKey" = 'transfers';

-- Old binaries cannot silently reintroduce a notification the new reader
-- rejects. The earlier migration's structural constraints remain in force.
ALTER TABLE "MatchNotificationIntent" ADD CONSTRAINT "no_retired_economy_intents"
CHECK ("kind" <> 'settlement' AND NOT (
  "kind" = 'product-announcement'
  AND COALESCE("payload"::jsonb #>> '{data,announcement,data,effect,kind}', '') = 'weekly-bucks'
));

COMMIT;
