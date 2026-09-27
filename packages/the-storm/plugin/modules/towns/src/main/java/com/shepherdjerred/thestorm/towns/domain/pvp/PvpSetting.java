package com.shepherdjerred.thestorm.towns.domain.pvp;

import java.time.Instant;

/**
 * A player's own PvP switch, once they have changed it. A player who never has is on and may change
 * it at once.
 *
 * @param on whether they fight other players
 * @param changedAt when they last changed it
 */
public record PvpSetting(boolean on, Instant changedAt) {}
