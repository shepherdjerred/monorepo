package com.shepherdjerred.thestorm.essentials.domain.place;

import java.util.Optional;

/**
 * Where a player can stand without suffocating, burning or falling into the void: a {@link
 * Ground#FLOOR} block underfoot, two {@link Ground#OPEN} blocks for body and head, all inside the
 * world's height range.
 */
public final class SafeSpots {

  /** How many horizontal blocks away the search looks after trying the original column. */
  public static final int HORIZONTAL_SEARCH_DISTANCE = 8;

  private SafeSpots() {}

  /** What a block means for a player standing in or on it. */
  public enum Ground {
    /** Solid and harmless: something to stand on, and something a body cannot occupy. */
    FLOOR,
    /** Passable and harmless: air, plants, water, snow layers a body can occupy. */
    OPEN,
    /** Lava, fire, magma, cactus, portals and the like: neither floor nor space. */
    HAZARD
  }

  /** A world's blocks as {@link Ground}. */
  @FunctionalInterface
  public interface BlockView {
    /** The block at the coordinates, which are inside the height range. */
    Ground at(int x, int y, int z);
  }

  /**
   * A block coordinate.
   *
   * @param x block x
   * @param y block y (the feet)
   * @param z block z
   */
  public record BlockPos(int x, int y, int z) {

    /** The block containing {@code position}. */
    public static BlockPos of(Position position) {
      return new BlockPos(
          (int) Math.floor(position.x()),
          (int) Math.floor(position.y()),
          (int) Math.floor(position.z()));
    }

    BlockPos up(int blocks) {
      return new BlockPos(x, y + blocks, z);
    }
  }

  /**
   * A world's height range.
   *
   * @param min the lowest block y, inclusive
   * @param max the highest block y, exclusive
   */
  public record HeightRange(int min, int max) {
    public HeightRange {
      if (max <= min) {
        throw new IllegalArgumentException("max must be above min: " + min + ".." + max);
      }
    }

    boolean contains(int y) {
      return y >= min && y < max;
    }
  }

  /** Whether a player can stand with their feet at {@code feet}. */
  public static boolean isSafe(BlockView view, HeightRange range, BlockPos feet) {
    var below = feet.up(-1);
    var head = feet.up(1);
    if (!range.contains(below.y()) || !range.contains(head.y())) {
      return false;
    }
    return view.at(below.x(), below.y(), below.z()) == Ground.FLOOR
        && view.at(feet.x(), feet.y(), feet.z()) == Ground.OPEN
        && view.at(head.x(), head.y(), head.z()) == Ground.OPEN;
  }

  /**
   * The nearest safe spot in {@code start}'s full-height column, then in nearby columns up to
   * {@link #HORIZONTAL_SEARCH_DISTANCE} blocks away. Empty if no safe standing space exists.
   */
  public static Optional<BlockPos> find(BlockView view, HeightRange range, BlockPos start) {
    var original = findInColumn(view, range, start);
    if (original.isPresent()) return original;
    for (var radius = 1; radius <= HORIZONTAL_SEARCH_DISTANCE; radius++) {
      var nearby = findInRing(view, range, start, radius);
      if (nearby.isPresent()) return nearby;
    }
    return Optional.empty();
  }

  private static Optional<BlockPos> findInRing(
      BlockView view, HeightRange range, BlockPos start, int radius) {
    var best = Optional.<BlockPos>empty();
    for (var x = start.x() - radius; x <= start.x() + radius; x++) {
      for (var z = start.z() - radius; z <= start.z() + radius; z++) {
        if (Math.max(Math.abs(x - start.x()), Math.abs(z - start.z())) != radius) continue;
        var nearby = findInColumn(view, range, new BlockPos(x, start.y(), z));
        best = nearerHeight(best, nearby, start);
      }
    }
    return best;
  }

  private static Optional<BlockPos> nearerHeight(
      Optional<BlockPos> current, Optional<BlockPos> candidate, BlockPos start) {
    if (candidate.isEmpty()) return current;
    if (current.isEmpty()) return candidate;
    var currentDistance = Math.abs(current.orElseThrow().y() - start.y());
    var candidateDistance = Math.abs(candidate.orElseThrow().y() - start.y());
    return candidateDistance < currentDistance ? candidate : current;
  }

  private static Optional<BlockPos> findInColumn(
      BlockView view, HeightRange range, BlockPos start) {
    var distance = Math.max(start.y() - range.min(), range.max() - 1 - start.y());
    for (var offset = 0; offset <= distance; offset++) {
      var above = start.up(offset);
      if (isSafe(view, range, above)) return Optional.of(above);
      var below = start.up(-offset);
      if (offset > 0 && isSafe(view, range, below)) return Optional.of(below);
    }
    return Optional.empty();
  }
}
