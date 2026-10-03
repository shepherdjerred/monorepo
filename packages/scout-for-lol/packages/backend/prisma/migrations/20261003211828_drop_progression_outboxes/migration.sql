-- Hall and Duel announcements are durable notification intents; the legacy
-- outbox tables and their drain are retired.

-- DropTable
DROP TABLE "DuelStatusOutbox";

-- DropTable
DROP TABLE "HallRecordBreakOutbox";
