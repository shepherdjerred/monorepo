package com.shepherdjerred.thestorm.essentials.domain.teleport;

import com.shepherdjerred.thestorm.essentials.domain.place.Position;

/**
 * The pause before a teleport. Moving to another block (or world) cancels it; looking around does
 * not. Taking damage also cancels it, which the adapter reports directly.
 */
public final class Warmup {

  private Warmup() {}

  /** Whether moving from {@code start} to {@code now} cancels the warmup. */
  public static boolean interruptedBy(Position start, Position now) {
    return !start.world().equals(now.world())
        || block(start.x()) != block(now.x())
        || block(start.y()) != block(now.y())
        || block(start.z()) != block(now.z());
  }

  private static long block(double coordinate) {
    return (long) Math.floor(coordinate);
  }
}
