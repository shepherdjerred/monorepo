package com.shepherdjerred.thestorm.qol.domain.grave;

import java.time.Instant;
import java.util.UUID;

/**
 * A grave: where a player's items went when they died.
 *
 * @param id the grave's id, also stored on its block
 * @param owner the player who died
 * @param ownerName the owner's name when they died, for other players to read
 * @param pos where the grave block stands
 * @param createdAt when the owner died; the lock and expiry count from here
 * @param replaced the block the grave replaced (its block data string, such as {@code
 *     minecraft:cave_air}), put back when the grave goes
 */
public record Grave(
    UUID id, UUID owner, String ownerName, GravePos pos, Instant createdAt, String replaced) {

  public Grave {
    if (ownerName.isBlank()) {
      throw new IllegalArgumentException("ownerName must not be blank");
    }
    if (replaced.isBlank()) {
      throw new IllegalArgumentException("replaced must name the block the grave replaced");
    }
  }
}
