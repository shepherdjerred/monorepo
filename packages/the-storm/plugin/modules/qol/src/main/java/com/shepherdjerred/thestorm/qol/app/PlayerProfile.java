package com.shepherdjerred.thestorm.qol.app;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * When qol first saw a player, and when they last used random teleport.
 *
 * @param player the player
 * @param firstSeen the first time this module saw them
 * @param lastRtp their last random teleport, if they have used one
 */
public record PlayerProfile(UUID player, Instant firstSeen, Optional<Instant> lastRtp) {}
