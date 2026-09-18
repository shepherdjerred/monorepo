-- ScoutWorkflowStart: one row per REQUEST rather than one per workflow id.
--
-- Every V2 workflow id derives from identity alone (stage + trigger, stage +
-- match, stage + intent key), so keying this table by the workflow id meant it
-- could hold exactly one request per logical workflow forever: one operator
-- reconcile per stage, one projection repair per match. Each request now has
-- its own key and the workflow id is a non-unique indexed column.
--
-- Existing rows are kept and given generated keys; no column or row is dropped.
ALTER TABLE "ScoutWorkflowStart" ADD COLUMN "requestId" TEXT;
UPDATE "ScoutWorkflowStart" SET "requestId" = gen_random_uuid()::text;
ALTER TABLE "ScoutWorkflowStart" ALTER COLUMN "requestId" SET NOT NULL;

ALTER TABLE "ScoutWorkflowStart" DROP CONSTRAINT "ScoutWorkflowStart_pkey";
ALTER TABLE "ScoutWorkflowStart"
  ADD CONSTRAINT "ScoutWorkflowStart_pkey" PRIMARY KEY ("requestId");

-- The key is minted by the application as a lowercase hyphenated UUID and has
-- no column default: a row that arrives without one is refused, not filled in.
ALTER TABLE "ScoutWorkflowStart"
  ADD CONSTRAINT "ScoutWorkflowStart_request_id_shape_check"
  CHECK ("requestId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- At most ONE in-flight (unaccepted) request per workflow id. The domain's
-- transition functions (recovery/workflow-start-transitions) decide that an
-- in-flight request is adopted and an accepted one is succeeded; this index
-- mirrors the "in-flight" half so two simultaneous requests for one workflow
-- id can only ever insert one row, whatever the requesters read first.
CREATE UNIQUE INDEX "ScoutWorkflowStart_in_flight_request_key"
ON "ScoutWorkflowStart"("requestedWorkflowId") WHERE "acceptedAt" IS NULL;

-- Latest-accepted lookups by workflow id.
CREATE INDEX "ScoutWorkflowStart_requestedWorkflowId_acceptedAt_idx"
ON "ScoutWorkflowStart"("requestedWorkflowId", "acceptedAt");
