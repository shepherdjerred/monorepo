package com.shepherdjerred.thestorm.essentials.app;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** Read-only moderation history exposed across module boundaries. */
public record ModerationHistory(
    String actionId,
    Optional<UUID> actor,
    String actorName,
    String reason,
    Instant at,
    Optional<Instant> expiresAt) {}
