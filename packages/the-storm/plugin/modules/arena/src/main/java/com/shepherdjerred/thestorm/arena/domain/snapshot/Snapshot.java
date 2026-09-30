package com.shepherdjerred.thestorm.arena.domain.snapshot;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Everything a player had before joining an arena, stored before anything is cleared and restored
 * exactly when they leave, die, disconnect, or rejoin after a crash.
 *
 * @param player the player
 * @param arena the arena they joined
 * @param position where they stood
 * @param vitals health, hunger and game mode
 * @param experience their experience
 * @param inventory their whole inventory (armor and off hand included), serialized by Paper
 * @param effects their active potion effects
 * @param takenAt when the snapshot was taken
 */
public record Snapshot(
    UUID player,
    String arena,
    Position position,
    Vitals vitals,
    Experience experience,
    ItemData inventory,
    List<EffectRecord> effects,
    Instant takenAt) {

  public Snapshot {
    effects = List.copyOf(effects);
  }
}
