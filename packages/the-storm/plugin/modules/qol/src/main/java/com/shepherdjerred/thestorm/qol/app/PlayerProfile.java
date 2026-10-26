package com.shepherdjerred.thestorm.qol.app;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * When qol first saw a player, and when they last arrived from a wilderness search.
 *
 * @param player the player
 * @param firstSeen the first time this module saw them
 * @param lastRtp their last successful RTP, which starts the search throttle
 * @param starterRtpCharges compass trips still left; zero means the compass is finished
 */
public record PlayerProfile(
    UUID player, Instant firstSeen, Optional<Instant> lastRtp, int starterRtpCharges) {
  /** Compass trips a new profile, and a profile still holding the one-shot compass, receives. */
  public static final int STARTER_CHARGES = 8;

  public PlayerProfile {
    if (starterRtpCharges < 0) {
      throw new IllegalArgumentException("starter charges must not be negative");
    }
  }
}
