package com.shepherdjerred.thestorm.essentials.app;

import java.time.Instant;
import java.util.UUID;
import java.util.Optional;

/** Read-only moderation history exposed across module boundaries. */
public record ModerationHistory(
    String actionId,
    Optional<UUID> actor,
    String actorName,
    String reason,
    Instant at,
    Optional<Instant> expiresAt) {}
