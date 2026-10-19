package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.function.Predicate;
import org.junit.jupiter.api.Test;

final class MovementSafetyTest {
  private static final Vec3 START = new Vec3(0.5, 1, 0.5);

  private record Terrain(
      Predicate<Vec3> floor,
      Predicate<Vec3> obstruction,
      Predicate<Vec3> danger,
      Predicate<Vec3> contact)
      implements MovementSafety.Terrain {
    Terrain(Predicate<Vec3> floor, Predicate<Vec3> obstruction, Predicate<Vec3> danger) {
      this(floor, obstruction, danger, floor);
    }

    @Override
    public boolean clear(Vec3 feet) {
      return !obstruction.test(feet);
    }

    @Override
    public boolean supported(Vec3 feet, double drop) {
      return floor.test(feet);
    }

    @Override
    public boolean grounded(Vec3 feet) {
      return contact.test(feet);
    }

    @Override
    public boolean hazardous(Vec3 feet) {
      return danger.test(feet);
    }

    @Override
    public boolean inside(Vec3 feet) {
      return feet.x() > -5 && feet.x() < 5 && feet.z() > -5 && feet.z() < 5;
    }
  }

  private static MovementSafety.Result move(Terrain terrain, Vec3 target, Hop hop) {
    return MovementSafety.choose(terrain, new MovementSafety.Request(START, target, hop));
  }

  @Test
  void anOpenSupportedApproachKeepsItsDestination() {
    var target = START.plus(3, 0, 0);
    var result = move(new Terrain(point -> true, point -> false, point -> false), target, Hop.WALK);
    assertThat(result.destination()).contains(target);
    assertThat(result.reason()).isEqualTo(MovementSafety.Reason.CLEAR);
  }

  @Test
  void anOrdinaryWalkStepsUpOntoAHalfBlockAsVanillaDoes() {
    // A stair or slab step half a block high from x = 1: the body collides with it at its current
    // feet but is clear on top of it. Walking up it is ordinary movement, not a blocked corridor
    // to be sidestepped along forever.
    var step =
        new Terrain(
            point -> true,
            point -> point.y() < 1.5 - 1e-9 && point.x() + 0.3 > 1.0,
            point -> false);
    var target = new Vec3(2.5, 1.5, 0.5);

    var result = move(step, target, Hop.WALK);

    assertThat(result.reason()).isEqualTo(MovementSafety.Reason.CLEAR);
    assertThat(result.destination()).contains(target);
  }

  @Test
  void aBodyPerchedAboveItsRouteStepsOffAsADropWhenTheLandingIsSafe() {
    // Perched two blocks up on a block edge, a stall counter or a roof, the body is routed from
    // the graph node beneath it, so its next waypoint is an ordinary walk at ground level.
    var perch = new Vec3(0.5, 3, 0.5);
    var ground =
        new Terrain(
            point -> point.y() <= 1 + 1e-9 || point.horizontalDistance(perch) < 0.3,
            point -> false,
            point -> false);
    var result =
        MovementSafety.choose(
            ground, new MovementSafety.Request(perch, new Vec3(2.5, 1, 0.5), Hop.WALK));
    assertThat(result.reason()).isEqualTo(MovementSafety.Reason.CLEAR);

    var lava =
        new Terrain(
            point -> point.y() <= 1 + 1e-9 || point.horizontalDistance(perch) < 0.3,
            point -> false,
            point -> point.y() < 2 && point.horizontalDistance(perch) > 1);
    assertThat(
            MovementSafety.choose(
                    lava, new MovementSafety.Request(perch, new Vec3(2.5, 1, 0.5), Hop.WALK))
                .reason())
        .as("a hazardous landing is still refused")
        .isNotEqualTo(MovementSafety.Reason.CLEAR);
  }

  @Test
  void aSteppedUpWalkFindsItsFloorOnTopOfTheStep() {
    // A ladder top or a stair: the floor beyond the step is the step's own top, half a block above
    // the feet, so floor is found only by looking from the stepped-up height.
    var onTop = (java.util.function.Predicate<Vec3>) point -> point.x() + 0.3 > 1.0;
    var step =
        new Terrain(
            point -> onTop.test(point) ? point.y() >= 1.5 - 1e-9 : Math.abs(point.y() - 1) < 1e-9,
            point -> onTop.test(point) && point.y() < 1.5 - 1e-9,
            point -> false);
    var target = new Vec3(2.5, 1.5, 0.5);

    var result = move(step, target, Hop.WALK);

    assertThat(result.reason()).isEqualTo(MovementSafety.Reason.CLEAR);
  }

  @Test
  void aStepTallerThanVanillaStepHeightStillBlocksAnOrdinaryWalk() {
    var wall =
        new Terrain(
            point -> true,
            point -> point.y() < 2.0 - 1e-9 && point.x() + 0.3 > 1.0,
            point -> false);
    var result =
        MovementSafety.choose(
            wall, new MovementSafety.Request(START, new Vec3(2.5, 2.0, 0.5), Hop.WALK));
    assertThat(result.reason()).isNotEqualTo(MovementSafety.Reason.CLEAR);
  }

  @Test
  void localCombatAndRecoverySteeringCannotWalkIntoFireOrVoid() {
    var terrain = new Terrain(point -> point.x() < 1, point -> false, point -> point.z() < 0);
    var result = move(terrain, START.plus(3, 0, 0), Hop.WALK);
    assertThat(result.reason()).isEqualTo(MovementSafety.Reason.REDIRECTED);
    assertThat(result.destination())
        .hasValueSatisfying(
            point -> {
              assertThat(point.x()).isLessThan(1);
              assertThat(point.z()).isGreaterThanOrEqualTo(0);
            });
  }

  @Test
  void aTrappedBotStopsInsteadOfInventingAnUnsafeSidestep() {
    var terrain =
        new Terrain(point -> point.horizontalDistance(START) < 0.1, point -> false, point -> false);
    var result = move(terrain, START.plus(3, 0, 0), Hop.WALK);
    assertThat(result.reason()).isEqualTo(MovementSafety.Reason.BLOCKED);
    assertThat(result.destination()).isEmpty();
  }

  @Test
  void aPartialGroundContactCanRecoverOnlyTowardFullySupportedOnwardTerrain() {
    var floor = (Predicate<Vec3>) point -> point.x() >= 0.55;
    var grounded = new Terrain(floor, point -> false, point -> false, START::equals);
    assertThat(move(grounded, START.plus(0.5, 0, 0), Hop.WALK).reason())
        .isEqualTo(MovementSafety.Reason.CLEAR);
    assertThat(move(grounded, START.plus(-0.5, 0, 0), Hop.WALK).reason())
        .isEqualTo(MovementSafety.Reason.BLOCKED);
    var airborne = new Terrain(floor, point -> false, point -> false, point -> false);
    assertThat(move(airborne, START.plus(0.5, 0, 0), Hop.WALK).reason())
        .isEqualTo(MovementSafety.Reason.BLOCKED);
  }

  @Test
  void aNearDestinationDoesNotProbeBeyondTheEndOfItsBridge() {
    var terrain = new Terrain(point -> point.x() < 0.8, point -> false, point -> false);
    var target = START.plus(0.1, 0, 0);
    assertThat(move(terrain, target, Hop.WALK).destination()).contains(target);
  }

  @Test
  void authoredLeapCrossesTheGapButUnlabelledChasingDoesNot() {
    var terrain =
        new Terrain(point -> point.x() < 1 || point.x() >= 3, point -> false, point -> false);
    var target = START.plus(3, 0, 0);
    assertThat(move(terrain, target, Hop.LEAP).destination()).contains(target);
    assertThat(move(terrain, target, Hop.WALK).reason()).isNotEqualTo(MovementSafety.Reason.CLEAR);
  }

  @Test
  void aJumpNeedsLandingSupportAndArcClearanceButNotFloorThroughoutItsArc() {
    var terrain =
        new Terrain(point -> point.x() >= 1 && point.y() == 2, point -> false, point -> false);
    var target = new Vec3(1.5, 2, 0.5);
    assertThat(move(terrain, target, Hop.JUMP).destination()).contains(target);
    var lowCeiling =
        new Terrain(terrain.floor(), point -> point.y() >= 2 && point.x() < 1, point -> false);
    assertThat(move(lowCeiling, target, Hop.JUMP).reason())
        .isEqualTo(MovementSafety.Reason.BLOCKED);
  }

  @Test
  void authoredDropsStillRejectUnsafeLandingsAndLeaveDepthToTheFinalSurvivalGate() {
    var terrain = new Terrain(point -> true, point -> false, point -> point.x() > 1);
    assertThat(move(terrain, new Vec3(1.5, -2, 0.5), Hop.DROP).reason())
        .isEqualTo(MovementSafety.Reason.BLOCKED);
    assertThat(move(terrain, new Vec3(0.9, -7, 0.5), Hop.DROP).reason())
        .isEqualTo(MovementSafety.Reason.CLEAR);
  }

  @Test
  void aVerticalClimbIsMovementRatherThanArrival() {
    var terrain = new Terrain(point -> true, point -> false, point -> false);
    var target = START.plus(0, 1, 0);
    assertThat(move(terrain, target, Hop.CLIMB).destination()).contains(target);
  }

  @Test
  void submergedAscentAndDescentAreMovementRatherThanArrival() {
    var terrain = new Terrain(point -> true, point -> false, point -> false);
    assertThat(move(terrain, START.plus(0, 2, 0), Hop.SWIM).destination())
        .contains(START.plus(0, 2, 0));
    assertThat(move(terrain, START.plus(0, -2, 0), Hop.SWIM).destination())
        .contains(START.plus(0, -2, 0));
  }

  @Test
  void swimmingAscendsInItsClearColumnBeforeCrossingARaisedBankFace() {
    var bank = new Terrain(point -> true, point -> point.x() >= 1 && point.y() < 2, point -> false);
    var target = new Vec3(1.5, 2, 0.5);
    assertThat(move(bank, target, Hop.SWIM).destination()).contains(START.withY(2));
    var blockedColumn =
        new Terrain(
            bank.floor(),
            point -> bank.obstruction().test(point) || (point.x() < 1 && point.y() >= 1.6),
            point -> false);
    assertThat(move(blockedColumn, target, Hop.SWIM).reason())
        .isEqualTo(MovementSafety.Reason.BLOCKED);
  }

  @Test
  void swimmingClearsTheUpperFloorHorizontallyBeforeDescendingIntoTheLowerColumn() {
    var from = START.withY(2);
    var target = START.plus(1, 0, 0);
    var floor = new Terrain(point -> true, point -> point.x() < 1 && point.y() < 2, point -> false);
    var request = new MovementSafety.Request(from, target, Hop.SWIM);
    assertThat(MovementSafety.choose(floor, request).destination()).contains(target.withY(2));
    var unsafeSecondLeg =
        new Terrain(floor.floor(), floor.obstruction(), point -> point.x() >= 1 && point.y() < 1.8);
    assertThat(MovementSafety.choose(unsafeSecondLeg, request).reason())
        .isEqualTo(MovementSafety.Reason.BLOCKED);
  }

  @Test
  void aFourCellDiagonalLeapMatchesTheDirectedGraphSpan() {
    var terrain = new Terrain(point -> true, point -> false, point -> false);
    assertThat(move(terrain, START.plus(4, -5, 4), Hop.LEAP).reason())
        .isEqualTo(MovementSafety.Reason.CLEAR);
  }

  @Test
  void aPendingVerticalDropIsCertifiedInsteadOfBeingDiscardedAsArrival() {
    var terrain = new Terrain(point -> true, point -> false, point -> false);
    var destination = START.plus(0, -9, 0);
    assertThat(move(terrain, destination, Hop.DROP).destination()).contains(destination);
  }

  @Test
  void climbingCanRiseAboveTheTopLedgeBeforeMovingOffTheLadder() {
    var terrain =
        new Terrain(point -> true, point -> point.z() > 0.9 && point.y() < 2, point -> false);
    assertThat(move(terrain, START.plus(0, 1, 1), Hop.CLIMB).reason())
        .isEqualTo(MovementSafety.Reason.CLEAR);
    var ceiling =
        new Terrain(point -> true, point -> point.y() >= 1.8 && point.z() < 0.9, point -> false);
    assertThat(move(ceiling, START.plus(0, 1, 1), Hop.CLIMB).reason())
        .isEqualTo(MovementSafety.Reason.BLOCKED);
  }

  @Test
  void anAirborneJumpRetainsItsTakeoffDropBudgetButStillRechecksTheLanding() {
    var terrain =
        new Terrain(point -> point.x() < 1 || point.x() >= 3, point -> false, point -> false);
    var landing = START.plus(3, -5, 0);
    var apex = START.plus(0.4, 1.252203, 0);
    var flight = new MovementSafety.Request(apex, landing, Hop.LEAP, java.util.Optional.of(START));
    assertThat(MovementSafety.choose(terrain, flight).reason())
        .isEqualTo(MovementSafety.Reason.CLEAR);
    var ceiling = new Terrain(terrain.floor(), point -> point.y() >= 3, point -> false);
    assertThat(MovementSafety.choose(ceiling, flight).reason())
        .isEqualTo(MovementSafety.Reason.CLEAR);
    var fire = new Terrain(terrain.floor(), point -> false, point -> point.x() >= 3);
    assertThat(MovementSafety.choose(fire, flight).reason())
        .isEqualTo(MovementSafety.Reason.BLOCKED);
    assertThat(move(terrain, START.plus(3, -7, 0), Hop.LEAP).reason())
        .isEqualTo(MovementSafety.Reason.CLEAR);
  }

  @Test
  void fireAppearingOnTheCurrentPositionDoesNotTrapTheBotInIt() {
    var terrain =
        new Terrain(point -> true, point -> false, point -> point.horizontalDistance(START) < 0.5);
    assertThat(move(terrain, START.plus(2, 0, 0), Hop.WALK).reason())
        .isEqualTo(MovementSafety.Reason.CLEAR);
  }
}
