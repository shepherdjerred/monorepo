UPDATE "AgentJob"
SET
  "status" = 'paused',
  "nextRunAt" = NULL,
  "lastStatus" = 'unsupported_tool',
  "lastError" = 'This direct-tool job references a capability removed from Birmel or an action that is no longer permitted.',
  "claimedAt" = NULL,
  "claimedBy" = NULL,
  "leaseExpiresAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "payloadKind" = 'tool'
  AND (
    "toolId" IN (
      'manage-guild',
      'manage-channel',
      'moderate-member',
      'manage-role',
      'manage-member',
      'manage-automod-rule',
      'manage-webhook',
      'manage-invite',
      'manage-emoji',
      'manage-sticker',
      'execute-shell-command'
    )
    OR (
      "toolId" = 'manage-message'
      AND json_extract("toolInput", '$.action') IN (
        'reply',
        'edit',
        'delete',
        'bulk-delete',
        'pin',
        'unpin',
        'remove-reaction'
      )
    )
    OR (
      "toolId" = 'manage-thread'
      AND json_extract("toolInput", '$.action') IN ('modify', 'add-member')
    )
    OR (
      "toolId" = 'browser-automation'
      AND (
        json_extract("toolInput", '$.action') IN (
          'start',
          'list-profiles',
          'cookies'
        )
        OR json_extract("toolInput", '$.profile') IS NOT NULL
        OR json_extract("toolInput", '$.instanceId') IS NOT NULL
        OR json_extract("toolInput", '$.filename') IS NOT NULL
        OR (
          json_extract("toolInput", '$.action') IN ('open', 'navigate')
          AND (
            json_type("toolInput", '$.url') IS NOT 'text'
            OR lower(json_extract("toolInput", '$.url')) NOT LIKE 'https://%'
          )
        )
      )
    )
  )
  AND "status" IN (
    'active',
    'retrying',
    'running',
    'paused',
    'completed',
    'failed'
  )
  AND (
    "lastStatus" IS NULL
    OR "lastStatus" NOT IN ('effect_ambiguous', 'recovery_ambiguous')
  )
  -- Leave the active claim intact so normal lease recovery can classify the
  -- current durable checkpoint without replaying or discarding its effect.
  AND NOT EXISTS (
    SELECT 1
    FROM "AgentJobRun"
    WHERE "AgentJobRun"."jobId" = "AgentJob"."id"
      AND "AgentJobRun"."status" IN ('effect_in_flight', 'effect_acknowledged')
  );
