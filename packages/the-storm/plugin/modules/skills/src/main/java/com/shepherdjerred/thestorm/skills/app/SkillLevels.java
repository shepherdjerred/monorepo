package com.shepherdjerred.thestorm.skills.app;

import com.shepherdjerred.thestorm.skills.domain.Skill;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Asynchronous progress and ranking API for commands and other modules. */
public interface SkillLevels {
  CompletableFuture<SkillProgress> progress(UUID playerId);

  CompletableFuture<List<RankedSkillPlayer>> top(int limit);

  CompletableFuture<SkillProgress> award(UUID playerId, String name, Skill skill, int experience);

  /** Remembers an XP-bearing block placed by a player, including across server restarts. */
  CompletableFuture<Boolean> markPlaced(BlockPosition position);

  /** Removes a placed-block marker; true if the broken block was player-placed. */
  CompletableFuture<Boolean> wasPlacedAndForget(BlockPosition position);

  /** Atomically transfers placed-block markers; true if any source was marked. */
  CompletableFuture<Boolean> movePlaced(List<BlockMove> moves);

  /** Consumes sapling markers and marks grown logs in one write if any sapling was placed. */
  CompletableFuture<Boolean> growPlacedTree(List<BlockPosition> saplings, List<BlockPosition> logs);

  /** Moves placed provenance off its source coordinate when a block begins falling. */
  CompletableFuture<Boolean> launchFalling(BlockPosition source, UUID entityId);

  /** Transfers an airborne marker to its landed block, if the source was placed. */
  CompletableFuture<Boolean> landFalling(UUID entityId, BlockPosition destination);

  /** Clears provenance when a carried or falling block disappears without placement. */
  CompletableFuture<Boolean> forgetFalling(UUID entityId);
}
