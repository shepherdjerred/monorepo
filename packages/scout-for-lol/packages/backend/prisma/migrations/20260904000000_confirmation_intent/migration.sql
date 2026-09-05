-- One confirmation-intent table replaces the dare-only one. The protocol is
-- unchanged — actor-bound, single-use, expiring, idempotent — but the row no
-- longer assumes its target is a dare, and the action is stored exactly once.
--
-- `kind` folds in the old `action` column: it used to live both there and
-- inside `actionPayload`, and consuming an intent carried a runtime assertion
-- that threw when the two disagreed. With one discriminator that state is
-- unrepresentable.
--
-- `serverId` is denormalized from the dare. Guild visibility used to be
-- checked by joining through `dare.serverId`; it becomes a direct column
-- comparison, which is only equivalent if the stored value comes from the
-- target row rather than from a caller.
CREATE TABLE "ConfirmationIntent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "resultJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dareId" INTEGER,
    "expectedRevision" INTEGER,
    CONSTRAINT "ConfirmationIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConfirmationIntent_idempotencyKey_key" ON "ConfirmationIntent"("idempotencyKey");
CREATE INDEX "ConfirmationIntent_dareId_expiresAt_idx" ON "ConfirmationIntent"("dareId", "expiresAt");

ALTER TABLE "ConfirmationIntent" ADD CONSTRAINT "ConfirmationIntent_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "BucksDareV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy every existing intent. Three columns here are load-bearing:
--
-- * The payload is rewritten, not copied. Stored payloads discriminate on
--   `action` (`{"action":"contribute","amount":5}`) and the new union
--   discriminates on `kind`, so a straight copy would leave every in-flight
--   confirmation failing Zod validation at confirm time — and only when
--   someone clicks. The text is rebuilt to match what the application would
--   serialize byte for byte, because minting with an existing idempotency key
--   compares the stored payload against a freshly serialized one. Reading the
--   contribution amount through jsonb and casting it to int means an
--   unexpected payload fails this migration rather than writing malformed
--   JSON that only breaks at confirm time.
-- * `id` is preserved: a pending confirmation card in an open browser tab, and
--   the custom id of a live Discord button, both hold it.
-- * `consumedAt` and `resultJson` are preserved. Dropping them would make an
--   already-consumed intent confirmable again, which on `dare_fund` and
--   `dare_contribute` is a double-spend of real balances.
INSERT INTO "ConfirmationIntent" (
    id, kind, "serverId", "dareId", "expectedRevision", "actorDiscordId",
    payload, "idempotencyKey", "expiresAt", "consumedAt", "resultJson", "createdAt"
)
SELECT
    i.id,
    'dare_' || i.action,
    d."serverId",
    i."dareId",
    i.revision,
    i."actorDiscordId",
    CASE
        WHEN i.action = 'contribute'
            THEN '{"kind":"dare_contribute","amount":' || ((i."actionPayload"::jsonb ->> 'amount')::int)::text || '}'
        ELSE '{"kind":"dare_' || i.action || '"}'
    END,
    i."idempotencyKey",
    i."expiresAt",
    i."consumedAt",
    i."resultJson",
    i."createdAt"
FROM "BucksDareV2ConfirmationIntent" i
JOIN "BucksDareV2" d ON d.id = i."dareId";

DROP TABLE "BucksDareV2ConfirmationIntent";
