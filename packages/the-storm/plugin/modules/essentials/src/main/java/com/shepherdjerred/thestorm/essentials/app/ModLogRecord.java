package com.shepherdjerred.thestorm.essentials.app;

import java.time.Instant;
import java.util.Optional;

/**
 * One moderation audit entry, as other modules see it: the target is implied by the query, and the
 * action is its stored id.
 *
 * @param actionId what was done, for example {@code ban}
 * @param actorName who did it
 * @param reason why, as shown to the player
 * @param at when
 * @param expiresAt when a temporary ban ends; empty when permanent or not applicable
 */
public record ModLogRecord(
    String actionId, String actorName, String reason, Instant at, Optional<Instant> expiresAt) {}
