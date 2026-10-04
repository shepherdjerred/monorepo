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
