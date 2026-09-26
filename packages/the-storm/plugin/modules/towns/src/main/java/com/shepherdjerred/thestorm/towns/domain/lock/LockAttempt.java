package com.shepherdjerred.thestorm.towns.domain.lock;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * A player asking to lock a container.
 *
 * @param player who asks
 * @param blocks the container's blocks: one, or both halves of a double chest
 * @param standing what the player has to do with the container
 * @param newId the id the new lock gets
 */
public record LockAttempt(UUID player, List<BlockPos> blocks, Standing standing, UUID newId) {

  public LockAttempt {
    blocks = List.copyOf(blocks);
    if (blocks.isEmpty() || blocks.size() > Lock.MAX_BLOCKS) {
      throw new IllegalArgumentException("a container has one or two blocks: " + blocks);
    }
  }

  /**
   * What the player has to do with the container they want to lock.
   *
   * @param placedBy who placed it, when that was recorded; null for containers placed before locks
   *     existed, by WorldEdit or by a dispenser, and for generated ones
   * @param mayBuild true when the player may build where it stands
   * @param land whether it stands on a town's claim, and whether the player runs that town
   * @param bypass true for staff with the bypass permission
   */
  public record Standing(@Nullable UUID placedBy, boolean mayBuild, Ground land, boolean bypass) {}

  /** Where the container stands, as locking sees it. */
  public enum Ground {
    /** Not on a town's claim: whoever may build there may lock what nobody placed. */
    OPEN,
    /** On a claim of a town the player owns or assists: they may lock what nobody placed. */
    MANAGED_CLAIM,
    /** On a claim the player does not run: what nobody placed there is the town's. */
    OTHER_CLAIM,
  }
}
