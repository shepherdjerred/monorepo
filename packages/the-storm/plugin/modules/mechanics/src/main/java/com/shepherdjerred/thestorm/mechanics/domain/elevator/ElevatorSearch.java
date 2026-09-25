package com.shepherdjerred.thestorm.mechanics.domain.elevator;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Shape;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.util.LinkedHashSet;

/**
 * Sign elevators, as in CraftBook: a {@code [Lift Up]} sign moves the player to the next lift sign
 * straight above it, a {@code [Lift Down]} sign to the next one below, and {@code [Lift]} is a
 * floor that only receives.
 *
 * <p>The player keeps their horizontal position and their height relative to the sign. If that spot
 * is unsafe, the spots level with the sign, one below it and two below it are tried in turn. A spot
 * is safe when the block below is solid and not harmful and the player's feet and head are in
 * clear, harmless space. A floor with no safe spot refuses the ride rather than trying the next.
 */
public final class ElevatorSearch {

  private ElevatorSearch() {}

  public static Result<Landing, LiftProblem> find(BlockGrid grid, Ride ride, int maxDistance) {
    if (ride.mechanism() == Mechanism.LIFT) {
      return Result.err(new LiftProblem.FloorOnly());
    }
    var direction = ride.mechanism() == Mechanism.LIFT_UP ? Direction.UP : Direction.DOWN;
    for (var distance = 1; distance <= maxDistance; distance++) {
      var candidate = ride.sign().offset(direction, distance);
      if (!grid.contains(candidate)) {
        break;
      }
      if (isLift(grid, candidate)) {
        return land(grid, ride, candidate);
      }
    }
    return Result.err(new LiftProblem.NoFloor(direction == Direction.UP, maxDistance));
  }

  private static boolean isLift(BlockGrid grid, Pos pos) {
    return grid.signAt(pos).flatMap(SignView::mechanism).filter(Mechanism::isLift).isPresent();
  }

  private static Result<Landing, LiftProblem> land(BlockGrid grid, Ride ride, Pos floorSign) {
    var keptHeight = ride.feet().y() + floorSign.y() - ride.sign().y();
    var heights = new LinkedHashSet<Integer>();
    heights.add(keptHeight);
    heights.add(floorSign.y());
    heights.add(floorSign.y() - 1);
    heights.add(floorSign.y() - 2);
    for (var y : heights) {
      var feet = new Pos(ride.feet().x(), y, ride.feet().z());
      if (isSafe(grid, feet)) {
        return Result.ok(new Landing(feet, floorSign));
      }
    }
    return Result.err(new LiftProblem.UnsafeLanding(floorSign.y()));
  }

  /** Solid, harmless ground below and clear, harmless space for feet and head. */
  static boolean isSafe(BlockGrid grid, Pos feet) {
    var ground = feet.offset(Direction.DOWN);
    var head = feet.offset(Direction.UP);
    if (!grid.contains(ground) || !grid.contains(head)) {
      return false;
    }
    return grid.cellAt(ground).shape() == Shape.SOLID
        && grid.cellAt(feet).shape().isBreathable()
        && grid.cellAt(head).shape().isBreathable();
  }
}
