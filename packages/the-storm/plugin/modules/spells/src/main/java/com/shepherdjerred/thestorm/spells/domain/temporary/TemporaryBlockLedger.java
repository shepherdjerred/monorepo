package com.shepherdjerred.thestorm.spells.domain.temporary;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Every temporary block the plugin is responsible for. A block is first <em>reserved</em> (its
 * revert is being written to storage), then <em>placed</em> once storage confirms. A position holds
 * at most one temporary block, so a spell can never record another spell's block as the "original"
 * and make it permanent. Main thread only.
 */
public final class TemporaryBlockLedger {

  /** Where a temporary block is in its life. */
  public enum State {
    /** Its revert is being stored; the world is unchanged. */
    RESERVED,
    /** It is in the world and will be reverted. */
    PLACED
  }

  private record Entry(TemporaryBlock block, State state) {}

  private final Map<BlockKey, Entry> entries = new LinkedHashMap<>();

  /**
   * Reserves every block whose position is free, and returns those; blocks at positions already
   * held are skipped.
   */
  public List<TemporaryBlock> reserve(List<TemporaryBlock> blocks) {
    var reserved = new ArrayList<TemporaryBlock>();
    for (var block : blocks) {
      if (entries.putIfAbsent(block.key(), new Entry(block, State.RESERVED)) == null) {
        reserved.add(block);
      }
    }
    return reserved;
  }

  /** Records {@code blocks} that are already in the world, as loaded from storage at startup. */
  public void restore(List<TemporaryBlock> blocks) {
    for (var block : blocks) {
      entries.put(block.key(), new Entry(block, State.PLACED));
    }
  }

  /** Marks a reserved block as placed in the world. */
  public void placed(BlockKey key) {
    var entry = entries.get(key);
    if (entry == null) {
      throw new IllegalStateException("no temporary block reserved at " + key);
    }
    entries.put(key, new Entry(entry.block(), State.PLACED));
  }

  /** Forgets the block at {@code key} (reverted, or never placed). */
  public void release(BlockKey key) {
    entries.remove(key);
  }

  /** True when {@code key} holds a temporary block, reserved or placed. */
  public boolean holds(BlockKey key) {
    return entries.containsKey(key);
  }

  /** The state of the block at {@code key}, if one is held. */
  public Optional<State> state(BlockKey key) {
    return Optional.ofNullable(entries.get(key)).map(Entry::state);
  }

  /** Placed blocks whose time is up at {@code now}, earliest first. */
  public List<TemporaryBlock> due(Instant now) {
    return entries.values().stream()
        .filter(entry -> entry.state() == State.PLACED && !entry.block().revertAt().isAfter(now))
        .map(Entry::block)
        .sorted(Comparator.comparing(TemporaryBlock::revertAt))
        .toList();
  }

  /** Every placed block, due or not: what a shutdown reverts. */
  public List<TemporaryBlock> placed() {
    return entries.values().stream()
        .filter(entry -> entry.state() == State.PLACED)
        .map(Entry::block)
        .toList();
  }

  /** How many blocks are held. */
  public int size() {
    return entries.size();
  }
}
