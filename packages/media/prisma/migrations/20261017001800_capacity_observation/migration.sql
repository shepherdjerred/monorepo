CREATE TABLE "MediaCapacityObservation" (
    "role" TEXT NOT NULL,
    "cycleRevision" BIGINT NOT NULL DEFAULT 0,
    "cycleEpoch" INTEGER NOT NULL,
    "cycleStartedAt" TIMESTAMP(3) NOT NULL,
    "mountResultRevision" BIGINT,
    "mountOutcome" TEXT,
    "mountReason" TEXT,
    "mountEpoch" INTEGER,
    "mountCompletedAt" TIMESTAMP(3),
    "mountObservedAt" TIMESTAMP(3),
    "mountExpiresAt" TIMESTAMP(3),
    "mountBinding" JSONB,
    "mountBindingDigest" TEXT,
    "mountEvidence" JSONB,
    "sampleAttempt" BIGINT NOT NULL DEFAULT 0,
    "sampleAttemptCycle" BIGINT,
    "sampleAttemptStartedAt" TIMESTAMP(3),
    "sampleResultAttempt" BIGINT,
    "sampleOutcome" TEXT,
    "sampleReason" TEXT,
    "sampleEpoch" INTEGER,
    "sampleStartedAt" TIMESTAMP(3),
    "sampleObservedAt" TIMESTAMP(3),
    "sampleCompletedAt" TIMESTAMP(3),
    "sampleBinding" JSONB,
    "sampleBindingDigest" TEXT,
    "sampleIdentity" JSONB,
    "totalBytes" BIGINT,
    "availableBytes" BIGINT,
    CONSTRAINT "MediaCapacityObservation_pkey" PRIMARY KEY ("role"),
    CONSTRAINT "MediaCapacityObservation_role" CHECK ("role" IN ('movies', 'tv')),
    CONSTRAINT "MediaCapacityObservation_order" CHECK (
        "cycleRevision" >= 0 AND "cycleEpoch" >= 0 AND "sampleAttempt" >= 0
        AND ("mountResultRevision" IS NULL OR ("mountResultRevision" > 0 AND "mountResultRevision" <= "cycleRevision"))
        AND ("sampleResultAttempt" IS NULL OR ("sampleResultAttempt" > 0 AND "sampleResultAttempt" <= "sampleAttempt"))
        AND ("mountEpoch" IS NULL OR "mountEpoch" >= 0)
        AND ("sampleEpoch" IS NULL OR "sampleEpoch" >= 0)
        AND (("sampleAttempt" = 0 AND "sampleAttemptCycle" IS NULL AND "sampleAttemptStartedAt" IS NULL)
          OR ("sampleAttempt" > 0 AND "sampleAttemptCycle" IS NOT NULL AND "sampleAttemptCycle" > 0
            AND "sampleAttemptCycle" <= "cycleRevision" AND "sampleAttemptStartedAt" IS NOT NULL))
    ),
    CONSTRAINT "MediaCapacityObservation_mount_result" CHECK ((CASE
        WHEN "mountOutcome" IS NULL THEN
            "mountResultRevision" IS NULL AND "mountReason" IS NULL AND "mountEpoch" IS NULL
            AND "mountCompletedAt" IS NULL AND "mountObservedAt" IS NULL AND "mountExpiresAt" IS NULL
            AND "mountBinding" IS NULL AND "mountBindingDigest" IS NULL AND "mountEvidence" IS NULL
        WHEN "mountOutcome" = 'observed' THEN
            "mountResultRevision" IS NOT NULL AND "mountEpoch" IS NOT NULL AND "mountCompletedAt" IS NOT NULL
            AND "mountReason" IS NULL AND "mountObservedAt" IS NOT NULL AND "mountExpiresAt" IS NOT NULL
            AND "mountObservedAt" <= "mountCompletedAt" AND "mountObservedAt" < "mountExpiresAt"
            AND "mountExpiresAt" <= "mountObservedAt" + INTERVAL '120 seconds'
            AND "mountBinding" IS NOT NULL AND jsonb_typeof("mountBinding") = 'object'
            AND "mountBindingDigest" IS NOT NULL AND "mountBindingDigest" ~ '^[a-f0-9]{64}$'
            AND "mountEvidence" IS NOT NULL AND jsonb_typeof("mountEvidence") = 'object'
        WHEN "mountOutcome" = 'unavailable' THEN
            "mountResultRevision" IS NOT NULL AND "mountEpoch" IS NOT NULL AND "mountCompletedAt" IS NOT NULL
            AND "mountReason" IS NOT NULL AND "mountReason" IN ('mount_observation_failed', 'mount_proof_invalid')
            AND "mountObservedAt" IS NULL AND "mountExpiresAt" IS NULL
            AND "mountBinding" IS NULL AND "mountBindingDigest" IS NULL AND "mountEvidence" IS NULL
        ELSE FALSE END) IS TRUE),
    CONSTRAINT "MediaCapacityObservation_sample_result" CHECK ((CASE
        WHEN "sampleOutcome" IS NULL THEN
            "sampleResultAttempt" IS NULL AND "sampleReason" IS NULL AND "sampleEpoch" IS NULL
            AND "sampleStartedAt" IS NULL AND "sampleObservedAt" IS NULL AND "sampleCompletedAt" IS NULL
            AND "sampleBinding" IS NULL AND "sampleBindingDigest" IS NULL AND "sampleIdentity" IS NULL
            AND "totalBytes" IS NULL AND "availableBytes" IS NULL
        WHEN "sampleOutcome" = 'observed' THEN
            "sampleResultAttempt" IS NOT NULL AND "sampleEpoch" IS NOT NULL
            AND "sampleStartedAt" IS NOT NULL AND "sampleObservedAt" IS NOT NULL AND "sampleCompletedAt" IS NOT NULL
            AND "sampleStartedAt" <= "sampleObservedAt" AND "sampleObservedAt" <= "sampleCompletedAt"
            AND "sampleReason" IS NULL AND "sampleBinding" IS NOT NULL AND jsonb_typeof("sampleBinding") = 'object'
            AND "sampleBindingDigest" IS NOT NULL AND "sampleBindingDigest" ~ '^[a-f0-9]{64}$'
            AND "sampleIdentity" IS NOT NULL AND jsonb_typeof("sampleIdentity") = 'object'
            AND "totalBytes" IS NOT NULL AND "availableBytes" IS NOT NULL
            AND "totalBytes" > 0 AND "availableBytes" >= 0 AND "availableBytes" <= "totalBytes"
        WHEN "sampleOutcome" = 'unavailable' THEN
            "sampleResultAttempt" IS NOT NULL AND "sampleEpoch" IS NOT NULL
            AND "sampleStartedAt" IS NOT NULL AND "sampleCompletedAt" IS NOT NULL
            AND "sampleStartedAt" <= "sampleCompletedAt" AND "sampleObservedAt" IS NULL
            AND "sampleReason" IS NOT NULL AND "sampleReason" IN (
                'mount_missing', 'mount_unavailable', 'mount_expired', 'mount_future',
                'worker_mismatch', 'root_configuration_mismatch', 'root_missing', 'root_symlink',
                'root_not_directory', 'root_changed', 'statfs_failed', 'capacity_invalid', 'capacity_overflow'
            )
            AND "sampleBinding" IS NULL AND "sampleBindingDigest" IS NULL AND "sampleIdentity" IS NULL
            AND "totalBytes" IS NULL AND "availableBytes" IS NULL
        ELSE FALSE END) IS TRUE)
);
