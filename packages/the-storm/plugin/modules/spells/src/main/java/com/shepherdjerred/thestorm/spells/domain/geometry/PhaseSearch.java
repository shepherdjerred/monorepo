package com.shepherdjerred.thestorm.spells.domain.geometry;

/**
 * Phase: step through the wall in front of the caster to the first safe spot on its far side. Phase
 * refuses when nothing blocks the way (it is not a free teleport) and never stops inside a wall.
 */
public final class PhaseSearch {

  private PhaseSearch() {}

  /** Where a Phase ends. */
  public sealed interface Outcome {

    /** The caster arrives with their feet at {@code feet}. */
    record Through(BlockPos feet) implements Outcome {}

    /** Nothing blocked the way within reach. */
    record NoWall() implements Outcome {}

    /** A wall was there, but no safe spot within reach beyond it. */
    record NoExit() implements Outcome {}
  }

  /**
   * Walks from {@code feet} in {@code facing} up to {@code reach} blocks. The first blocked step
   * (feet or head not open) starts the wall; the first safe spot after it is the exit.
   */
  public static Outcome through(BlockProbe probe, BlockPos feet, Facing facing, int reach) {
    if (reach < 1) {
      throw new IllegalArgumentException("reach must be positive: " + reach);
    }
    var inWall = false;
    for (var step = 1; step <= reach; step++) {
      var pos = feet.offset(facing.dx() * step, 0, facing.dz() * step);
      var blocked = probe.at(pos) != Footing.OPEN || probe.at(pos.above()) != Footing.OPEN;
      if (blocked) {
        inWall = true;
      } else if (inWall && SafeSpots.isSafe(probe, pos)) {
        return new Outcome.Through(pos);
      }
    }
    return inWall ? new Outcome.NoExit() : new Outcome.NoWall();
  }
}
