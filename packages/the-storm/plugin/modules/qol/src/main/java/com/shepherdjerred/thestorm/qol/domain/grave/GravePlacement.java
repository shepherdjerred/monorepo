package com.shepherdjerred.thestorm.qol.domain.grave;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Finds the block a grave goes in: the nearest open block to where its owner died, preferring one
 * with solid ground under it so the grave can be walked up to. Never a hazard, never a block that
 * holds something (another grave, a chest, a torch), never outside the world's height.
 */
public final class GravePlacement {

  /** The widest search allowed. */
  public static final int MAX_RADIUS = 8;

  /** What a block is, for placing a grave. */
  public enum Cell {
    /** Air, water, grass and other blocks a grave may replace. */
    OPEN,
    /** A solid block a grave may stand on. */
    FLOOR,
    /** Anything else that must not be replaced: containers, torches, other graves. */
    BLOCKED,
    /** Lava, fire and the like. */
    HAZARD
  }

  /** Reads blocks in one world. */
  @FunctionalInterface
  public interface BlockView {
    Cell at(int x, int y, int z);
  }

  /**
   * The world's buildable heights.
   *
   * @param min the lowest block y
   * @param max one above the highest block y
   */
  public record HeightRange(int min, int max) {

    public HeightRange {
      if (max <= min) {
        throw new IllegalArgumentException("max must be above min");
      }
    }

    public boolean contains(int y) {
      return y >= min && y < max;
    }

    int clamp(int y) {
      return Math.clamp(y, min, max - 1);
    }
  }

  private record Offset(int dx, int dy, int dz) {
    int distanceSquared() {
      return dx * dx + dy * dy + dz * dz;
    }
  }

  private final List<Offset> offsets;

  /** Searches up to {@code radius} blocks away on each axis. */
  public GravePlacement(int radius) {
    if (radius < 0 || radius > MAX_RADIUS) {
      throw new IllegalArgumentException("radius must be 0-" + MAX_RADIUS + ": " + radius);
    }
    var all = new ArrayList<Offset>();
    for (var dx = -radius; dx <= radius; dx++) {
      for (var dy = -radius; dy <= radius; dy++) {
        for (var dz = -radius; dz <= radius; dz++) {
          all.add(new Offset(dx, dy, dz));
        }
      }
    }
    all.sort(
        Comparator.comparingInt(Offset::distanceSquared)
            .thenComparingInt(offset -> Math.abs(offset.dy()))
            .thenComparingInt(offset -> -offset.dy())
            .thenComparingInt(Offset::dx)
            .thenComparingInt(Offset::dz));
    this.offsets = List.copyOf(all);
  }

  /**
   * The block nearest {@code origin} (moved into the world's height first) for a grave: an open
   * block on solid ground if there is one in range, otherwise any open block, otherwise empty.
   */
  public Optional<GravePos> find(BlockView view, HeightRange range, GravePos origin) {
    var start = new GravePos(origin.world(), origin.x(), range.clamp(origin.y()), origin.z());
    var grounded = search(view, range, start, true);
    return grounded.isPresent() ? grounded : search(view, range, start, false);
  }

  private Optional<GravePos> search(
      BlockView view, HeightRange range, GravePos start, boolean needFloor) {
    for (var offset : offsets) {
      var pos = start.offset(offset.dx(), offset.dy(), offset.dz());
      if (range.contains(pos.y()) && fits(view, range, pos, needFloor)) {
        return Optional.of(pos);
      }
    }
    return Optional.empty();
  }

  private static boolean fits(BlockView view, HeightRange range, GravePos pos, boolean needFloor) {
    if (view.at(pos.x(), pos.y(), pos.z()) != Cell.OPEN) {
      return false;
    }
    if (!needFloor) {
      return true;
    }
    var below = pos.y() - 1;
    return range.contains(below) && view.at(pos.x(), below, pos.z()) == Cell.FLOOR;
  }
}
