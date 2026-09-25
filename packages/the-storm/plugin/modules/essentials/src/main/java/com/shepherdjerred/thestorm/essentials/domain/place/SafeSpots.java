package com.shepherdjerred.thestorm.essentials.domain.place;

import java.util.Optional;

/**
 * Where a player can stand without suffocating, burning or falling into the void: a {@link
 * Ground#FLOOR} block underfoot, two {@link Ground#OPEN} blocks for body and head, all inside the
 * world's height range.
 */
public final class SafeSpots {

  /** How many blocks above and below the destination the search looks. */
  public static final int SEARCH_DISTANCE = 8;

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
   * The nearest safe spot in {@code start}'s column: {@code start} itself, then one block up, one
   * down, two up, two down and so on, up to {@link #SEARCH_DISTANCE}. Empty if there is none.
   */
  public static Optional<BlockPos> find(BlockView view, HeightRange range, BlockPos start) {
    for (var distance = 0; distance <= SEARCH_DISTANCE; distance++) {
      var above = start.up(distance);
      if (isSafe(view, range, above)) {
        return Optional.of(above);
      }
      var below = start.up(-distance);
      if (distance > 0 && isSafe(view, range, below)) {
        return Optional.of(below);
      }
    }
    return Optional.empty();
  }
}
