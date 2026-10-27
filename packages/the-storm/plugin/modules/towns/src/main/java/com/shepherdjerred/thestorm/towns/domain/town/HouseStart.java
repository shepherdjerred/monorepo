package com.shepherdjerred.thestorm.towns.domain.town;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.time.Instant;
import java.util.Optional;

/**
 * Whether placements in one chunk are a player starting a house. A bed, or a chest together with a
 * door, counts at once. A count of solid blocks counts only after they have stayed in that chunk or
 * a neighboring chunk.
 */
public final class HouseStart {

  private HouseStart() {}

  /**
   * What was placed in one chunk.
   *
   * @param bed a bed was placed there
   * @param door a door was placed there
   * @param chest a chest was placed there
   * @param solidBlocks solid blocks placed there
   * @param stayedSince when they were first seen in this chunk's neighborhood, if they still are
   */
  public record Placements(
      boolean bed, boolean door, boolean chest, int solidBlocks, Optional<Instant> stayedSince) {}

  /**
   * The chunk to claim, when {@code placed} is enough.
   *
   * @param chunk the chunk they are building in
   * @param placed what was placed there, and how long they have stayed nearby
   * @param now when the latest placement happened
   * @param policy the camp thresholds
   */
  public static Optional<ChunkPos> ready(
      ChunkPos chunk, Placements placed, Instant now, CampPolicy policy) {
    if (placed.bed() || (placed.door() && placed.chest())) {
      return Optional.of(chunk);
    }
    var stayed =
        placed.stayedSince().isPresent()
            && !now.isBefore(placed.stayedSince().orElseThrow().plus(policy.settleStay()));
    return placed.solidBlocks() >= policy.settleBlocks() && stayed
        ? Optional.of(chunk)
        : Optional.empty();
  }
}
