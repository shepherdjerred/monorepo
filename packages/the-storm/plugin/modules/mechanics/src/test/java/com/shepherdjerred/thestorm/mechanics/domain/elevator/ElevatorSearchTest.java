package com.shepherdjerred.thestorm.mechanics.domain.elevator;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.STONE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import org.junit.jupiter.api.Test;

/**
 * A lift shaft at x=0, z=0 with wall signs at eye level (y+1 above the floor's feet), and the
 * player standing at x=0, z=1 in front of them.
 */
final class ElevatorSearchTest {

  private static final Pos GROUND_SIGN = new Pos(0, 65, 0);
  private static final Pos GROUND_FEET = new Pos(0, 64, 1);

  /** Floors (solid ground under the player's column) with a lift sign at eye level. */
  private static TestGrid floors(int... feetHeights) {
    var grid = new TestGrid();
    for (var feet : feetHeights) {
      grid.solid(new Pos(0, feet - 1, 1), STONE);
      grid.wallSign(new Pos(0, feet + 1, 0), "[Lift]", Direction.SOUTH);
    }
    return grid;
  }

  private static Result<Landing, LiftProblem> ride(
      TestGrid grid, Pos sign, Mechanism mechanism, Pos feet) {
    return ElevatorSearch.find(grid, new Ride(sign, mechanism, feet), 64);
  }

  @Test
  void liftUpReachesTheNextFloorAbove() {
    var grid = floors(64, 70, 80);

    var result = ride(grid, GROUND_SIGN, Mechanism.LIFT_UP, GROUND_FEET);

    assertThat(result).isEqualTo(Result.ok(new Landing(new Pos(0, 70, 1), new Pos(0, 71, 0))));
  }

  @Test
  void liftDownReachesTheNextFloorBelow() {
    var grid = floors(40, 64, 70);

    var result = ride(grid, new Pos(0, 71, 0), Mechanism.LIFT_DOWN, new Pos(0, 70, 1));

    assertThat(result).isEqualTo(Result.ok(new Landing(new Pos(0, 64, 1), GROUND_SIGN)));
  }

  @Test
  void anyLiftSignIsAFloor() {
    var grid = floors(64).solid(new Pos(0, 69, 1), STONE);
    grid.wallSign(new Pos(0, 71, 0), "[Lift Down]", Direction.SOUTH);

    var result = ride(grid, GROUND_SIGN, Mechanism.LIFT_UP, GROUND_FEET);

    assertThat(result.map(Landing::feet)).isEqualTo(Result.ok(new Pos(0, 70, 1)));
  }

  @Test
  void otherSignsInTheShaftAreNotFloors() {
    var grid = floors(64, 80);
    grid.wallSign(new Pos(0, 71, 0), "[Bridge]", Direction.SOUTH);

    var result = ride(grid, GROUND_SIGN, Mechanism.LIFT_UP, GROUND_FEET);

    assertThat(result.map(Landing::feet)).isEqualTo(Result.ok(new Pos(0, 80, 1)));
  }

  @Test
  void aLiftStopOnlyReceives() {
    var result = ride(floors(64, 70), GROUND_SIGN, Mechanism.LIFT, GROUND_FEET);

    assertThat(result).isEqualTo(Result.err(new LiftProblem.FloorOnly()));
  }

  @Test
  void noFloorWithinReachIsReported() {
    var grid = floors(64, 200);

    var up = ElevatorSearch.find(grid, new Ride(GROUND_SIGN, Mechanism.LIFT_UP, GROUND_FEET), 50);
    var down = ride(grid, GROUND_SIGN, Mechanism.LIFT_DOWN, GROUND_FEET);

    assertThat(up).isEqualTo(Result.err(new LiftProblem.NoFloor(true, 50)));
    assertThat(down).isEqualTo(Result.err(new LiftProblem.NoFloor(false, 64)));
  }

  @Test
  void theSearchStopsAtTheWorldsEdge() {
    var nearBottom = new Pos(0, -63, 0);

    var result = ride(floors(), nearBottom, Mechanism.LIFT_DOWN, new Pos(0, -64, 1));

    assertThat(result).isEqualTo(Result.err(new LiftProblem.NoFloor(false, 64)));
  }

  @Test
  void aSignAtFeetHeightStillLandsOnItsFloor() {
    var grid = floors(64).solid(new Pos(0, 69, 1), STONE);
    grid.wallSign(new Pos(0, 70, 0), "[Lift]", Direction.SOUTH);

    var result = ride(grid, GROUND_SIGN, Mechanism.LIFT_UP, GROUND_FEET);

    assertThat(result.map(Landing::feet)).isEqualTo(Result.ok(new Pos(0, 70, 1)));
  }

  @Test
  void aFloorWithNoGroundIsUnsafe() {
    var grid = floors(64);
    grid.wallSign(new Pos(0, 81, 0), "[Lift]", Direction.SOUTH);

    var result = ride(grid, GROUND_SIGN, Mechanism.LIFT_UP, GROUND_FEET);

    assertThat(result).isEqualTo(Result.err(new LiftProblem.UnsafeLanding(81)));
  }

  @Test
  void harmfulGroundIsUnsafe() {
    var grid = floors(64, 80).hazard(new Pos(0, 79, 1), "minecraft:magma_block");

    var result = ride(grid, GROUND_SIGN, Mechanism.LIFT_UP, GROUND_FEET);

    assertThat(result).isEqualTo(Result.err(new LiftProblem.UnsafeLanding(81)));
  }

  @Test
  void aBlockedHeadIsUnsafe() {
    var grid = floors(64, 80).solid(new Pos(0, 81, 1), STONE);

    var result = ride(grid, GROUND_SIGN, Mechanism.LIFT_UP, GROUND_FEET);

    // The other spots tried have the block itself at the feet or nothing to stand on.
    assertThat(result).isEqualTo(Result.err(new LiftProblem.UnsafeLanding(81)));
  }

  @Test
  void waterAtTheLandingIsUnsafe() {
    var grid = floors(64, 80).water(new Pos(0, 80, 1));

    var result = ride(grid, GROUND_SIGN, Mechanism.LIFT_UP, GROUND_FEET);

    assertThat(result).isEqualTo(Result.err(new LiftProblem.UnsafeLanding(81)));
  }

  @Test
  void passableBlocksAreSafeToStandIn() {
    var grid = floors(64, 80).passable(new Pos(0, 80, 1), "minecraft:short_grass");

    var result = ride(grid, GROUND_SIGN, Mechanism.LIFT_UP, GROUND_FEET);

    assertThat(result.map(Landing::feet)).isEqualTo(Result.ok(new Pos(0, 80, 1)));
  }

  @Test
  void aPlayerStandingHigherKeepsTheirHeightWhenItIsSafe() {
    // A step: the player stands one block up, on a slab-like ledge, at both floors.
    var grid = floors(64, 80).solid(new Pos(0, 64, 1), STONE).solid(new Pos(0, 80, 1), STONE);

    var result = ride(grid, GROUND_SIGN, Mechanism.LIFT_UP, new Pos(0, 65, 1));

    assertThat(result.map(Landing::feet)).isEqualTo(Result.ok(new Pos(0, 81, 1)));
  }

  @Test
  void onlyLiftSignsRide() {
    assertThatThrownBy(() -> new Ride(GROUND_SIGN, Mechanism.BRIDGE, GROUND_FEET))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
