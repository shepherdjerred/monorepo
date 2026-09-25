package com.shepherdjerred.thestorm.shards.domain;

import java.util.Optional;

/**
 * A player at the altar asking the storm to upgrade the item in their hand.
 *
 * @param category the held item's gear category, or empty when it cannot be upgraded
 * @param current the held item's tier, or empty when it has never been upgraded
 * @param shardsHeld Storm Shards in the player's inventory
 * @param storming whether it is raining at the altar (see {@link AltarSky})
 */
public record UpgradeRequest(
    Optional<GearCategory> category,
    Optional<StormTier> current,
    int shardsHeld,
    boolean storming) {

  public UpgradeRequest {
    if (shardsHeld < 0) {
      throw new IllegalArgumentException("shardsHeld must not be negative: " + shardsHeld);
    }
  }
}
