package com.shepherdjerred.thestorm.qol.domain.grave;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Where a player died, and the places to try for their grave, nearest first.
 *
 * <p>A death in the void or in lava cannot leave a grave where it happened (the grave would be out
 * of the world or out of reach), so those graves go to the last place the player stood safely. If
 * no place works, the world spawn is the last resort.
 *
 * @param at the block the player died in
 * @param unreachable whether they died in the void or in lava
 * @param lastSafe the last block the player stood safely on, if known
 * @param worldSpawn the spawn of the world they died in
 */
public record DeathSite(
    GravePos at, boolean unreachable, Optional<GravePos> lastSafe, GravePos worldSpawn) {

  /** Where to look for a grave spot, in order. */
  public List<GravePos> origins() {
    var origins = new ArrayList<GravePos>();
    if (!unreachable) {
      origins.add(at);
    }
    lastSafe.ifPresent(origins::add);
    if (!origins.contains(worldSpawn)) {
      origins.add(worldSpawn);
    }
    return List.copyOf(origins);
  }
}
