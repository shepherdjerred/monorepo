package com.shepherdjerred.thestorm.towns.domain.claiming;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.util.UUID;

/**
 * A member of {@code town} asking to claim, unclaim or change {@code chunk}.
 *
 * @param player who asks
 * @param town their town
 * @param chunk the chunk
 * @param map the claims and regions as they stand
 */
public record ClaimAttempt(UUID player, Town town, ChunkPos chunk, ClaimMap map) {

  public ClaimAttempt {
    if (town.roleOf(player).isEmpty()) {
      throw new IllegalArgumentException(player + " is not a member of " + town.name());
    }
  }

  public TownRole role() {
    return town.roleOf(player).orElseThrow();
  }
}
