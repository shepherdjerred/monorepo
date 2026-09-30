package com.shepherdjerred.thestorm.essentials.domain.config;

import com.shepherdjerred.thestorm.essentials.domain.kit.BookContent;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.time.Duration;

/**
 * {@code plugins/TheStorm/essentials.yml}, owned by the repository.
 *
 * @param spawn where {@code /spawn} leads, new players arrive and players without a bed respawn
 * @param teleports warmup, requests, history and pricing
 * @param homeLimit how many homes each player may set
 * @param afkTimeout idle time before a player is marked away
 * @param kits the claimable kits and the starter kit
 * @param rules the book {@code /rules} opens
 */
public record EssentialsConfig(
    Position spawn,
    TeleportSettings teleports,
    int homeLimit,
    Duration afkTimeout,
    KitSettings kits,
    BookContent rules) {

  /** The most homes a player may be allowed. */
  public static final int MAX_HOME_LIMIT = 100;

  public EssentialsConfig {
    if (homeLimit < 1 || homeLimit > MAX_HOME_LIMIT) {
      throw new IllegalArgumentException("homeLimit must be 1-" + MAX_HOME_LIMIT);
    }
    if (afkTimeout.isNegative() || afkTimeout.isZero()) {
      throw new IllegalArgumentException("afkTimeout must be positive: " + afkTimeout);
    }
  }
}
