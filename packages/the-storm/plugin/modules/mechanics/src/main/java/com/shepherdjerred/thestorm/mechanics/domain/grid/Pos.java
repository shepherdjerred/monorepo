package com.shepherdjerred.thestorm.mechanics.domain.grid;

import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/** A block position. */
public record Pos(int x, int y, int z) {

  /** Orders positions by x, then y, then z, for deterministic tie-breaking. */
  public static final Comparator<Pos> ORDER =
      Comparator.comparingInt(Pos::x).thenComparingInt(Pos::y).thenComparingInt(Pos::z);

  public Pos offset(Direction direction) {
    return offset(direction, 1);
  }

  public Pos offset(Direction direction, int distance) {
    return new Pos(
        x + direction.dx() * distance,
        y + direction.dy() * distance,
        z + direction.dz() * distance);
  }

  public Pos offset(int dx, int dy, int dz) {
    return new Pos(x + dx, y + dy, z + dz);
  }

  /** The six face-adjacent positions, in {@link Direction} order. */
  public List<Pos> neighbors() {
    return Arrays.stream(Direction.values()).map(this::offset).toList();
  }

  /** The squared straight-line distance to {@code other}. */
  public long distanceSquared(Pos other) {
    long ddx = (long) x - other.x;
    long ddy = (long) y - other.y;
    long ddz = (long) z - other.z;
    return ddx * ddx + ddy * ddy + ddz * ddz;
  }

  /** How far {@code other} lies from here along {@code direction} (negative if behind). */
  public int distanceAlong(Pos other, Direction direction) {
    return (other.x - x) * direction.dx()
        + (other.y - y) * direction.dy()
        + (other.z - z) * direction.dz();
  }
}
