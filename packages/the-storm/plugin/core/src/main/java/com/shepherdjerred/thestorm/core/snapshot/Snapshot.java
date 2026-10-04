package com.shepherdjerred.thestorm.core.snapshot;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Everything a player had before joining an arena or a match, stored before anything is cleared and
 * restored exactly when they leave, die, disconnect, or rejoin after a crash.
 *
 * @param player the player
 * @param scope what they joined: the arena or match the snapshot was taken for
 * @param position where they stood
 * @param vitals health, hunger and game mode
 * @param experience their experience
 * @param inventory their whole inventory (armor and off hand included), serialized by Paper
 * @param effects their active potion effects
 * @param takenAt when the snapshot was taken
 */
public record Snapshot(
    UUID player,
    String scope,
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
