package com.shepherdjerred.thestorm.core.players;

import java.time.Instant;
import java.util.UUID;

/**
 * A player who has joined at least once.
 *
 * @param uuid the player's id
 * @param lastName the name they last joined with
 * @param lastSeen when they last joined
 */
public record KnownPlayer(UUID uuid, String lastName, Instant lastSeen) {}
