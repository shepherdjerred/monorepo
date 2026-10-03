package com.shepherdjerred.thestorm.quests.domain.engine;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Blocks players placed (and blocks the world generated, such as cobblestone from lava), so that
 * breaking them again does not count for mine objectives and a player breaking their own block
 * takes back a place objective's credit. Entries expire after {@code memory}; pistons move them.
 * The adapter persists every change so the memory survives restarts.
 */
public final class PlacedBlocks {

  private final Map<Position, Placed> blocks = new HashMap<>();
  private final Duration memory;

  public PlacedBlocks(Duration memory) {
    if (memory.isNegative() || memory.isZero()) {
      throw new IllegalArgumentException("the memory must be positive");
    }
    this.memory = memory;
  }

  /** A block position. */
  public record Position(String world, int x, int y, int z) {

    /** This moved by the offset. */
    public Position offset(int dx, int dy, int dz) {
      return new Position(world, x + dx, y + dy, z + dz);
    }
  }

  /**
   * A remembered block.
   *
   * @param position where it is
   * @param placer who placed it, or empty for a generated block
   * @param at when
   */
  public record Placed(Position position, Optional<UUID> placer, Instant at) {}

  /** What breaking a block means for objectives. */
  public enum Break {
    /** Nobody placed it (or long ago): it counts as mined. */
    NATURAL,
    /** The breaker placed it: it takes back one of their placements. */
    OWN,
    /** Someone else placed it, or the world generated it: it counts for nothing. */
    PLACED
  }

  /** Remembers stored entries (at enable). */
  public void load(Collection<Placed> stored) {
    stored.forEach(placed -> blocks.put(placed.position(), placed));
  }

  /** A player placed a block, or (with no placer) the world generated one. */
  public Placed placed(Position position, Optional<UUID> placer, Instant now) {
    var placed = new Placed(position, placer, now);
    blocks.put(position, placed);
    return placed;
  }

  /** {@code breaker} broke the block at {@code position}; it is forgotten either way. */
  public Break broken(Position position, UUID breaker, Instant now) {
    var placed = blocks.remove(position);
    if (placed == null || expired(placed, now)) {
      return Break.NATURAL;
    }
    return placed.placer().filter(breaker::equals).isPresent() ? Break.OWN : Break.PLACED;
  }

  /**
   * A piston moved the blocks at {@code from} by the offset. Returns the moved entries (their new
   * positions), for persisting.
   */
  public List<Placed> moved(List<Position> from, int dx, int dy, int dz) {
    var moving = new ArrayList<Placed>();
    for (var position : from) {
      var placed = blocks.remove(position);
      if (placed != null) {
        moving.add(placed);
      }
    }
    var moved = new ArrayList<Placed>();
    for (var placed : moving) {
      var next = new Placed(placed.position().offset(dx, dy, dz), placed.placer(), placed.at());
      blocks.put(next.position(), next);
      moved.add(next);
    }
    return moved;
  }

  /** Whether the block at {@code position} is remembered as placed. */
  public boolean remembers(Position position, Instant now) {
    var placed = blocks.get(position);
    return placed != null && !expired(placed, now);
  }

  /** Forgets entries older than the memory; returns the cutoff used. */
  public Instant expire(Instant now) {
    var cutoff = now.minus(memory);
    blocks.values().removeIf(placed -> placed.at().isBefore(cutoff));
    return cutoff;
  }

  /** How many blocks are remembered. */
  public int size() {
    return blocks.size();
  }

  private boolean expired(Placed placed, Instant now) {
    return placed.at().plus(memory).isBefore(now);
  }
}
