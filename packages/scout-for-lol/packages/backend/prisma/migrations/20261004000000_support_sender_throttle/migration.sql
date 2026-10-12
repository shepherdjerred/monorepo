CREATE TABLE "SupportSenderThrottle" (
    "discordId" TEXT NOT NULL,
    "inboundAt" TIMESTAMP(3)[] NOT NULL DEFAULT ARRAY[]::TIMESTAMP(3)[],
    "uploadAt" TIMESTAMP(3)[] NOT NULL DEFAULT ARRAY[]::TIMESTAMP(3)[],
    "lastAlertAt" TIMESTAMP(3),
    "lastReceiptAt" TIMESTAMP(3),
    "lastFailureNoticeAt" TIMESTAMP(3),

    CONSTRAINT "SupportSenderThrottle_pkey" PRIMARY KEY ("discordId")
);

INSERT INTO "SupportSenderThrottle" (
    "discordId",
    "inboundAt",
    "uploadAt",
    "lastAlertAt",
    "lastReceiptAt"
)
SELECT
    conversation."discordId",
    ARRAY(
        SELECT feedback."createdAt"
        FROM "Feedback" AS feedback
        WHERE feedback."conversationId" = conversation."id"
            AND feedback."direction" = 'INBOUND'
            AND feedback."createdAt" >= NOW() - INTERVAL '1 minute'
        ORDER BY feedback."createdAt"
    ),
    ARRAY(
        SELECT attachment."createdAt"
        FROM "SupportAttachment" AS attachment
        WHERE attachment."conversationId" = conversation."id"
            AND attachment."createdAt" >= NOW() - INTERVAL '1 minute'
        ORDER BY attachment."createdAt"
    ),
    conversation."lastAlertAt",
    conversation."lastReceiptAt"
FROM "SupportConversation" AS conversation;

-- Old pods may still insert Feedback with no conversationId during a rolling deploy.
CREATE FUNCTION support_attach_legacy_feedback() RETURNS trigger AS $$
DECLARE
    conversation_id TEXT;
BEGIN
    INSERT INTO "SupportConversation" (
        "id",
        "discordId",
        "username",
        "lastMessageAt"
    )
    VALUES (
        gen_random_uuid()::text,
        NEW."discordId",
        NEW."discordUsername",
        NEW."createdAt"
    )
    ON CONFLICT ("discordId") DO UPDATE SET
        "username" = COALESCE(EXCLUDED."username", "SupportConversation"."username"),
        "lastMessageAt" = GREATEST("SupportConversation"."lastMessageAt", EXCLUDED."lastMessageAt")
    RETURNING "id" INTO conversation_id;
    NEW."conversationId" := conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER feedback_attach_legacy_conversation
BEFORE INSERT ON "Feedback"
FOR EACH ROW
WHEN (NEW."conversationId" IS NULL)
EXECUTE FUNCTION support_attach_legacy_feedback();
