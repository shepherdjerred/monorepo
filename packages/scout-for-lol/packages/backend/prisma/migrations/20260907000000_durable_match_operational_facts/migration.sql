-- Durable match pipeline: operational facts and receipts.
--
-- Persistence for the @scout-for-lol/domain unions (match-processing,
-- notifications, recovery) plus workflow-start requests and an append-only
-- operator audit trail. Purely additive. Enum-shaped columns are TEXT with
-- CHECK constraints mirroring each union's closed vocabulary, and per-variant
-- payload columns are CHECKed present exactly in the states that carry them,
-- following the InitialMatchHistoryImport precedent.

-- One row per observed Riot match; the primary key on riotMatchId is the
-- ownership claim. pipelineOwner NULL is the domain's `unowned` variant.
-- promotedAt mirrors promoteArchiveOnlyToFull: only a FULL row may carry it,
-- and a FULL row without it was born FULL (promotion is impossible there).
CREATE TABLE "MatchObservation" (
    "riotMatchId" TEXT NOT NULL,
    "platformRoute" TEXT NOT NULL,
    "processingPolicy" TEXT NOT NULL,
    "pipelineOwner" TEXT,
    "promotedAt" TIMESTAMP(3),
    "gameCreatedAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "matchObjectKey" TEXT,
    "matchDigest" TEXT,
    "timelineObjectKey" TEXT,
    "timelineDigest" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchObservation_pkey" PRIMARY KEY ("riotMatchId"),
    CONSTRAINT "MatchObservation_policy_check"
      CHECK ("processingPolicy" IN ('ARCHIVE_ONLY', 'FULL')),
    CONSTRAINT "MatchObservation_owner_check"
      CHECK ("pipelineOwner" IS NULL OR "pipelineOwner" IN ('LEGACY_V1', 'TEMPORAL_V2')),
    CONSTRAINT "MatchObservation_promotion_check"
      CHECK ("promotedAt" IS NULL OR "processingPolicy" = 'FULL'),
    CONSTRAINT "MatchObservation_platform_route_check"
      CHECK ("platformRoute" IN (
        'BR1', 'EUN1', 'EUW1', 'JP1', 'KR', 'LA1', 'LA2', 'ME1',
        'NA1', 'OC1', 'RU', 'SG2', 'TR1', 'TW2', 'VN2', 'PBE1'
      )),
    -- Riot match ids are `{platform}_{gameId}`; the row's platformRoute must
    -- be the id's own platform prefix, and the whole id must have the shape
    -- the RiotMatchId brand demands so a stored row is always readable.
    CONSTRAINT "MatchObservation_match_id_platform_check"
      CHECK (split_part("riotMatchId", '_', 1) = "platformRoute"),
    CONSTRAINT "MatchObservation_riot_match_id_format_check"
      CHECK ("riotMatchId" ~ '^[A-Z0-9]+_[0-9]+$'),
    CONSTRAINT "MatchObservation_object_key_length_check"
      CHECK (
        ("matchObjectKey" IS NULL OR char_length("matchObjectKey") >= 1) AND
        ("timelineObjectKey" IS NULL OR char_length("timelineObjectKey") >= 1)
      ),
    -- An artifact reference is a key + digest pair; never half of one.
    CONSTRAINT "MatchObservation_match_artifact_check"
      CHECK (("matchObjectKey" IS NULL) = ("matchDigest" IS NULL)),
    CONSTRAINT "MatchObservation_timeline_artifact_check"
      CHECK (("timelineObjectKey" IS NULL) = ("timelineDigest" IS NULL)),
    CONSTRAINT "MatchObservation_match_digest_format_check"
      CHECK ("matchDigest" IS NULL OR "matchDigest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "MatchObservation_timeline_digest_format_check"
      CHECK ("timelineDigest" IS NULL OR "timelineDigest" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "MatchObservation_processingPolicy_observedAt_idx"
ON "MatchObservation"("processingPolicy", "observedAt");

CREATE INDEX "MatchObservation_gameCreatedAt_idx"
ON "MatchObservation"("gameCreatedAt");

-- Observation <-> tracked account association. FK-by-value on riotMatchId,
-- no relation: ingestion records participants independently of other tables.
CREATE TABLE "MatchTrackedAccount" (
    "riotMatchId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "playerId" INTEGER,
    "accountId" INTEGER,
    "cursorAdvancedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchTrackedAccount_pkey" PRIMARY KEY ("riotMatchId", "puuid"),
    CONSTRAINT "MatchTrackedAccount_riot_match_id_format_check"
      CHECK ("riotMatchId" ~ '^[A-Z0-9]+_[0-9]+$'),
    -- Riot PUUIDs are exactly 78 characters; anything else is unreadable
    -- through the LeaguePuuid brand.
    CONSTRAINT "MatchTrackedAccount_puuid_length_check"
      CHECK (char_length("puuid") = 78),
    CONSTRAINT "MatchTrackedAccount_ids_positive_check"
      CHECK (
        ("playerId" IS NULL OR "playerId" >= 1) AND
        ("accountId" IS NULL OR "accountId" >= 1)
      )
);

CREATE INDEX "MatchTrackedAccount_puuid_cursorAdvancedAt_idx"
ON "MatchTrackedAccount"("puuid", "cursorAdvancedAt");

-- Durable processing receipts. The unique constraint spells out the domain's
-- matchProcessingReceiptIdentityKey (kind:version:scopeKey) as columns.
-- scopeKey is the domain's receiptScopeKey and stands in for the split scope
-- columns because those are nullable and Postgres unique indexes treat NULLs
-- as distinct; the scope_key CHECK keeps the representations consistent, and
-- the kind CHECK pins the ReceiptKind brand's kebab-case shape (no `:`, so
-- the composite identity encoding stays injective).
CREATE TABLE "MatchProcessingReceipt" (
    "id" BIGSERIAL NOT NULL,
    "riotMatchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "scopeGuildId" TEXT,
    "scopeAccountId" INTEGER,
    "scopeKey" TEXT NOT NULL,
    "evidence" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchProcessingReceipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MatchProcessingReceipt_riot_match_id_format_check"
      CHECK ("riotMatchId" ~ '^[A-Z0-9]+_[0-9]+$'),
    CONSTRAINT "MatchProcessingReceipt_kind_shape_check"
      CHECK ("kind" ~ '^[a-z0-9][a-z0-9-]*$'),
    CONSTRAINT "MatchProcessingReceipt_version_check"
      CHECK ("version" >= 1),
    CONSTRAINT "MatchProcessingReceipt_scope_id_shape_check"
      CHECK (
        ("scopeGuildId" IS NULL OR "scopeGuildId" ~ '^[0-9]{17,20}$') AND
        ("scopeAccountId" IS NULL OR "scopeAccountId" >= 1)
      ),
    CONSTRAINT "MatchProcessingReceipt_scope_kind_check"
      CHECK ("scopeKind" IN ('global', 'guild', 'account')),
    -- Each scope variant carries exactly its own column: guild has a guild id
    -- and no account id, account the reverse, global neither. Written as
    -- per-kind implications so an unknown kind fails only the vocabulary
    -- constraint above, keeping the two concerns separately testable.
    CONSTRAINT "MatchProcessingReceipt_scope_fields_check"
      CHECK (
        ("scopeKind" <> 'global' OR ("scopeGuildId" IS NULL AND "scopeAccountId" IS NULL)) AND
        ("scopeKind" <> 'guild' OR ("scopeGuildId" IS NOT NULL AND "scopeAccountId" IS NULL)) AND
        ("scopeKind" <> 'account' OR ("scopeGuildId" IS NULL AND "scopeAccountId" IS NOT NULL))
      ),
    CONSTRAINT "MatchProcessingReceipt_scope_key_check"
      CHECK ("scopeKey" = CASE "scopeKind"
        WHEN 'global' THEN 'global'
        WHEN 'guild' THEN 'guild:' || "scopeGuildId"
        WHEN 'account' THEN 'account:' || "scopeAccountId"::text
      END)
);

CREATE UNIQUE INDEX "MatchProcessingReceipt_riotMatchId_kind_version_scopeKey_key"
ON "MatchProcessingReceipt"("riotMatchId", "kind", "version", "scopeKey");

CREATE INDEX "MatchProcessingReceipt_kind_recordedAt_idx"
ON "MatchProcessingReceipt"("kind", "recordedAt");

-- Durable notification intents. The NotificationIntentState union is
-- flattened: `state` is the discriminant, and every per-variant payload
-- column is CHECKed present in exactly the states that carry it, so a row
-- always round-trips into a well-formed domain value. The last failure is
-- split into its two closed-vocabulary columns rather than stored as JSON so
-- a bad writer cannot brick the row for every future read, and `payload`
-- must be the notificationIntentCodec envelope of this same intent.
CREATE TABLE "MatchNotificationIntent" (
    "intentKey" TEXT NOT NULL,
    "riotMatchId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "attemptNonce" TEXT,
    "sendStartedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "messageId" TEXT,
    "suppressedReason" TEXT,
    "unknownObservedAt" TIMESTAMP(3),
    "lastFailureClassification" TEXT,
    "lastFailureReason" TEXT,
    "freshnessDeadline" TIMESTAMP(3) NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchNotificationIntent_pkey" PRIMARY KEY ("intentKey"),
    CONSTRAINT "MatchNotificationIntent_riot_match_id_format_check"
      CHECK ("riotMatchId" ~ '^[A-Z0-9]+_[0-9]+$'),
    CONSTRAINT "MatchNotificationIntent_key_shape_check"
      CHECK (
        char_length("intentKey") >= 1 AND
        ("attemptNonce" IS NULL OR char_length("attemptNonce") >= 1)
      ),
    -- Discord snowflakes are 17-20 digits; anything else is unreadable
    -- through the Discord id brands.
    CONSTRAINT "MatchNotificationIntent_discord_id_shape_check"
      CHECK (
        "targetId" ~ '^[0-9]{17,20}$' AND
        ("messageId" IS NULL OR "messageId" ~ '^[0-9]{17,20}$')
      ),
    CONSTRAINT "MatchNotificationIntent_payload_kind_check"
      CHECK (("payload"::jsonb ->> 'kind') = 'notification-intent'),
    CONSTRAINT "MatchNotificationIntent_state_check"
      CHECK ("state" IN (
        'pending', 'ready', 'sending', 'delivered', 'suppressed',
        'expired', 'permission-denied', 'unknown-delivery'
      )),
    CONSTRAINT "MatchNotificationIntent_target_kind_check"
      CHECK ("targetKind" IN ('channel', 'dm')),
    CONSTRAINT "MatchNotificationIntent_attempt_count_check"
      CHECK ("attemptCount" >= 0),
    -- sending and unknown-delivery are only reachable after beginSend, which
    -- mints the nonce and increments the count.
    CONSTRAINT "MatchNotificationIntent_attempted_states_check"
      CHECK (
        ("state" NOT IN ('sending', 'unknown-delivery')) OR
        ("attemptNonce" IS NOT NULL AND "attemptCount" >= 1)
      ),
    CONSTRAINT "MatchNotificationIntent_attempt_nonce_check"
      CHECK (("attemptNonce" IS NOT NULL) = ("state" IN ('sending', 'unknown-delivery'))),
    CONSTRAINT "MatchNotificationIntent_send_started_check"
      CHECK (("sendStartedAt" IS NOT NULL) = ("state" = 'sending')),
    CONSTRAINT "MatchNotificationIntent_delivered_at_check"
      CHECK (("deliveredAt" IS NOT NULL) = ("state" = 'delivered')),
    -- delivered MAY carry a message id; no other state may.
    CONSTRAINT "MatchNotificationIntent_message_id_check"
      CHECK ("messageId" IS NULL OR "state" = 'delivered'),
    CONSTRAINT "MatchNotificationIntent_suppressed_reason_check"
      CHECK (("suppressedReason" IS NOT NULL) = ("state" = 'suppressed')),
    CONSTRAINT "MatchNotificationIntent_suppressed_reason_vocab_check"
      CHECK (
        "suppressedReason" IS NULL OR
        "suppressedReason" IN ('stale', 'feature-disabled', 'recipient-preference')
      ),
    CONSTRAINT "MatchNotificationIntent_unknown_observed_check"
      CHECK (("unknownObservedAt" IS NOT NULL) = ("state" = 'unknown-delivery')),
    -- The failure columns come and go together, and each classification only
    -- admits its own reason vocabulary — the whole NotificationFailure union
    -- is CHECKed, since a persisted failure outlives the writer that made it.
    CONSTRAINT "MatchNotificationIntent_failure_pairing_check"
      CHECK (("lastFailureClassification" IS NULL) = ("lastFailureReason" IS NULL)),
    CONSTRAINT "MatchNotificationIntent_failure_vocab_check"
      CHECK (
        "lastFailureClassification" IS NULL OR
        ("lastFailureClassification" = 'retryable' AND "lastFailureReason" IN (
          'network', 'rate-limited', 'service-unavailable', 'timeout'
        )) OR
        ("lastFailureClassification" = 'terminal' AND "lastFailureReason" IN (
          'permission-denied', 'dm-disabled', 'budget-exhausted', 'target-not-found'
        ))
      )
);

CREATE INDEX "MatchNotificationIntent_state_freshnessDeadline_idx"
ON "MatchNotificationIntent"("state", "freshnessDeadline");

CREATE INDEX "MatchNotificationIntent_riotMatchId_idx"
ON "MatchNotificationIntent"("riotMatchId");

-- Recovery batches. Cursor columns exist only in `scanning` and count columns
-- only in `processing`, exactly mirroring the RecoveryBatchState union.
-- workflowId is the Temporal retry-adoption key, unique when present.
CREATE TABLE "MatchRecoveryBatch" (
    "recoveryBatchId" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'planned',
    "cursorPosition" TEXT,
    "pagesScanned" INTEGER,
    "pageBudget" INTEGER,
    "discoveredCount" INTEGER,
    "succeededCount" INTEGER,
    "suppressedCount" INTEGER,
    "failedCount" INTEGER,
    "abandonReason" TEXT,
    "workflowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchRecoveryBatch_pkey" PRIMARY KEY ("recoveryBatchId"),
    CONSTRAINT "MatchRecoveryBatch_key_shape_check"
      CHECK (
        char_length("recoveryBatchId") >= 1 AND
        ("cursorPosition" IS NULL OR char_length("cursorPosition") >= 1) AND
        ("workflowId" IS NULL OR char_length("workflowId") >= 1)
      ),
    CONSTRAINT "MatchRecoveryBatch_policy_check"
      CHECK ("policy" IN ('normal', 'stale-private-only', 'no-external')),
    CONSTRAINT "MatchRecoveryBatch_state_check"
      CHECK ("state" IN (
        'planned', 'scanning', 'processing', 'digesting', 'complete', 'abandoned'
      )),
    CONSTRAINT "MatchRecoveryBatch_cursor_presence_check"
      CHECK (
        ("state" = 'scanning' AND "pagesScanned" IS NOT NULL AND "pageBudget" IS NOT NULL) OR
        ("state" <> 'scanning' AND "pagesScanned" IS NULL AND "pageBudget" IS NULL
          AND "cursorPosition" IS NULL)
      ),
    -- The position is produced by an advance, so it exists exactly when at
    -- least one page has been scanned.
    CONSTRAINT "MatchRecoveryBatch_cursor_position_check"
      CHECK (("cursorPosition" IS NOT NULL) = (COALESCE("pagesScanned", 0) > 0)),
    CONSTRAINT "MatchRecoveryBatch_cursor_bounds_check"
      CHECK (
        "pagesScanned" IS NULL OR
        ("pagesScanned" >= 0 AND "pageBudget" >= 1 AND "pagesScanned" <= "pageBudget")
      ),
    -- All four counts exist in `processing` and none exists anywhere else; a
    -- plain biconditional would let a partial count set through outside
    -- `processing`, so both directions are spelled out.
    CONSTRAINT "MatchRecoveryBatch_counts_presence_check"
      CHECK (
        ("state" = 'processing' AND
          "discoveredCount" IS NOT NULL AND "succeededCount" IS NOT NULL AND
          "suppressedCount" IS NOT NULL AND "failedCount" IS NOT NULL) OR
        ("state" <> 'processing' AND
          "discoveredCount" IS NULL AND "succeededCount" IS NULL AND
          "suppressedCount" IS NULL AND "failedCount" IS NULL)
      ),
    CONSTRAINT "MatchRecoveryBatch_counts_bounds_check"
      CHECK (
        "discoveredCount" IS NULL OR (
          "discoveredCount" >= 0 AND "succeededCount" >= 0 AND
          "suppressedCount" >= 0 AND "failedCount" >= 0 AND
          "succeededCount" + "suppressedCount" + "failedCount" <= "discoveredCount"
        )
      ),
    CONSTRAINT "MatchRecoveryBatch_abandon_reason_check"
      CHECK (("abandonReason" IS NOT NULL) = ("state" = 'abandoned')),
    CONSTRAINT "MatchRecoveryBatch_abandon_reason_vocab_check"
      CHECK (
        "abandonReason" IS NULL OR
        "abandonReason" IN (
          'operator-cancelled', 'scan-budget-exhausted',
          'upstream-unavailable', 'superseded'
        )
      )
);

CREATE UNIQUE INDEX "MatchRecoveryBatch_workflowId_key"
ON "MatchRecoveryBatch"("workflowId");

CREATE INDEX "MatchRecoveryBatch_state_createdAt_idx"
ON "MatchRecoveryBatch"("state", "createdAt");

-- Workflow start requests. Only "start requested" / "start accepted" live
-- here (ScoutTemporalWork owns execution state); the primary key is the
-- requested workflow id so a crashed requester adopts its own request.
CREATE TABLE "ScoutWorkflowStart" (
    "requestedWorkflowId" TEXT NOT NULL,
    "workflowType" TEXT NOT NULL,
    "requestedBy" TEXT,
    "requestSource" TEXT NOT NULL,
    "inputPayload" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoutWorkflowStart_pkey" PRIMARY KEY ("requestedWorkflowId"),
    -- A run id is Temporal's acceptance evidence, so it cannot precede one.
    CONSTRAINT "ScoutWorkflowStart_run_id_check"
      CHECK ("runId" IS NULL OR "acceptedAt" IS NOT NULL),
    CONSTRAINT "ScoutWorkflowStart_text_shape_check"
      CHECK (
        char_length("requestedWorkflowId") >= 1 AND
        char_length("workflowType") >= 1 AND
        char_length("requestSource") >= 1 AND
        ("runId" IS NULL OR char_length("runId") >= 1) AND
        ("requestedBy" IS NULL OR "requestedBy" ~ '^[0-9]{17,20}$')
      ),
    -- Starts are typed by workflowType, and the input envelope's kind is that
    -- type — so a stored input can never be mistaken for another workflow's.
    CONSTRAINT "ScoutWorkflowStart_input_payload_kind_check"
      CHECK (("inputPayload"::jsonb ->> 'kind') = "workflowType")
);

CREATE INDEX "ScoutWorkflowStart_workflowType_requestedAt_idx"
ON "ScoutWorkflowStart"("workflowType", "requestedAt");

-- Append-only operator audit trail. No update path by design. The id is a
-- BIGSERIAL because the table only ever grows, and the nullable unique
-- idempotency key lets a retried Temporal activity replay its append without
-- double-writing the trail (Postgres unique indexes treat NULLs as distinct,
-- so keyless appends are unlimited).
CREATE TABLE "ScoutOperatorAuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoutOperatorAuditEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScoutOperatorAuditEvent_text_shape_check"
      CHECK (
        char_length("action") >= 1 AND
        char_length("subjectKind") >= 1 AND
        char_length("subjectId") >= 1 AND
        "actorDiscordId" ~ '^[0-9]{17,20}$' AND
        ("idempotencyKey" IS NULL OR char_length("idempotencyKey") >= 1)
      )
);

CREATE UNIQUE INDEX "ScoutOperatorAuditEvent_idempotencyKey_key"
ON "ScoutOperatorAuditEvent"("idempotencyKey");

CREATE INDEX "ScoutOperatorAuditEvent_subjectKind_subjectId_createdAt_idx"
ON "ScoutOperatorAuditEvent"("subjectKind", "subjectId", "createdAt");

CREATE INDEX "ScoutOperatorAuditEvent_actorDiscordId_createdAt_idx"
ON "ScoutOperatorAuditEvent"("actorDiscordId", "createdAt");
