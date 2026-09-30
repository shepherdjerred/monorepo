package com.shepherdjerred.thestorm.towns.domain.lock;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * A locked container: one block, or both halves of a double chest.
 *
 * @param id stable id
 * @param owner who locked it
 * @param blocks where it is; one or two blocks
 * @param trusted players the owner lets in, and whether each may also break it
 * @param options what else the owner allows
 */
public record Lock(
    UUID id, UUID owner, Set<BlockPos> blocks, Map<UUID, LockGrant> trusted, Options options) {

  /** A double chest is the largest container a lock covers. */
  public static final int MAX_BLOCKS = 2;

  public Lock {
    blocks = Set.copyOf(blocks);
    trusted = Map.copyOf(trusted);
    if (blocks.isEmpty() || blocks.size() > MAX_BLOCKS) {
      throw new IllegalArgumentException("a lock covers one or two blocks, not " + blocks.size());
    }
    if (trusted.containsKey(owner)) {
      throw new IllegalArgumentException("a lock's owner is not in its trusted list");
    }
  }

  /** A new lock of {@code owner}'s on {@code blocks}, trusting nobody and allowing nothing else. */
  public static Lock of(UUID id, UUID owner, Set<BlockPos> blocks) {
    return new Lock(id, owner, blocks, Map.of(), Options.NONE);
  }

  /**
   * What a lock's owner allows beyond the players they trust.
   *
   * @param sharedWithTown the owner's town mates may open it (never break it)
   * @param redstone redstone may make it dispense or craft, so anyone who can power it can make it
   *     give up its items
   */
  public record Options(boolean sharedWithTown, boolean redstone) {

    public static final Options NONE = new Options(false, false);
  }

  /** A copy that also covers {@code block}, the other half of a double chest. */
  public Lock withBlock(BlockPos block) {
    var next = new HashSet<>(blocks);
    next.add(block);
    return new Lock(id, owner, next, trusted, options);
  }

  /** A copy without {@code block}; only for a lock that covers another block too. */
  public Lock withoutBlock(BlockPos block) {
    var next = new HashSet<>(blocks);
    next.remove(block);
    return new Lock(id, owner, next, trusted, options);
  }

  /** A copy that trusts {@code player} with {@code grant}. */
  public Lock withTrust(UUID player, LockGrant grant) {
    var next = new HashMap<>(trusted);
    next.put(player, grant);
    return new Lock(id, owner, blocks, next, options);
  }

  /** A copy that no longer trusts {@code player}. */
  public Lock withoutTrust(UUID player) {
    var next = new HashMap<>(trusted);
    next.remove(player);
    return new Lock(id, owner, blocks, next, options);
  }

  public Lock withOptions(Options next) {
    return new Lock(id, owner, blocks, trusted, next);
  }

  /**
   * A copy owned by {@code newOwner}, who inherits it as it stands (for players leaving a town).
   */
  public Lock ownedBy(UUID newOwner) {
    var next = new HashMap<>(trusted);
    next.remove(newOwner);
    return new Lock(id, newOwner, blocks, next, options);
  }
}
