-- Retire the two legacy durable stores the V2 notification lane and the
-- receipt-probe effect fence replaced.
--
-- `ScoutEffectClaim` has no reader or writer left: guarded match effects read
-- their own evidence-bearing receipt under an advisory lock, notification sends
-- are owned by their intents, report sends by `ReportDeliveryChunk`, and the two
-- analytics events by a guild-scoped receipt and the report run's delivered
-- transition. Its rows record outcomes those stores already hold.
--
-- `BucksDareNotificationEvent` / `BucksDareNotificationDelivery` were the
-- pre-cutover Dare DM outbox. Their drain is retired, so a delivery still owed
-- has no other owner, and the notification lane never re-announces an event a
-- legacy row owned. Refuse to drop one rather than lose it unsent; an operator
-- drains or retires it first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "BucksDareNotificationDelivery"
    WHERE "deliveryState" IN ('pending', 'retry', 'delivering')
  ) THEN
    RAISE EXCEPTION 'Undelivered legacy Dare notifications remain; drain or retire them before migrating';
  END IF;
END $$;

DROP TABLE "BucksDareNotificationDelivery";
DROP TABLE "BucksDareNotificationEvent";
DROP TABLE "ScoutEffectClaim";
