package com.shepherdjerred.thestorm.spells.domain.geometry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class PhaseSearchTest {

  private static final BlockPos FEET = new BlockPos(0, 64, 0);

  @Test
  void stepsThroughAWallToTheFirstSafeSpotBeyond() {
    var grid = Grid.flat().pillar(0, 1, 65).pillar(0, 2, 65);

    assertThat(PhaseSearch.through(grid, FEET, Facing.SOUTH, 6))
        .isEqualTo(new PhaseSearch.Outcome.Through(new BlockPos(0, 64, 3)));
  }

  @Test
  void aHalfHeightObstacleCountsAsAWall() {
    var grid = Grid.flat().set(1, 64, 0, Footing.SOLID);

    assertThat(PhaseSearch.through(grid, FEET, Facing.EAST, 4))
        .isEqualTo(new PhaseSearch.Outcome.Through(new BlockPos(2, 64, 0)));
  }

  @Test
  void openGroundIsNoWall() {
    assertThat(PhaseSearch.through(Grid.flat(), FEET, Facing.NORTH, 6))
        .isEqualTo(new PhaseSearch.Outcome.NoWall());
  }

  @Test
  void aWallThickerThanTheReachHasNoExit() {
    var grid = Grid.flat();
    for (var x = -1; x >= -6; x--) {
      grid.pillar(x, 0, 65);
    }

    assertThat(PhaseSearch.through(grid, FEET, Facing.WEST, 6))
        .isEqualTo(new PhaseSearch.Outcome.NoExit());
  }

  @Test
  void aChasmBeyondTheWallIsNotAnExit() {
    var grid = Grid.flat().pillar(0, 1, 65);
    for (var z = 2; z <= 6; z++) {
      grid.set(0, 63, z, Footing.OPEN);
    }

    assertThat(PhaseSearch.through(grid, FEET, Facing.SOUTH, 6))
        .isEqualTo(new PhaseSearch.Outcome.NoExit());
  }

  @Test
  void lavaBeyondTheWallIsSkipped() {
    var grid = Grid.flat().pillar(0, 1, 65).set(0, 63, 2, Footing.HAZARD);

    assertThat(PhaseSearch.through(grid, FEET, Facing.SOUTH, 6))
        .isEqualTo(new PhaseSearch.Outcome.Through(new BlockPos(0, 64, 3)));
  }

  @Test
  void reachMustBePositive() {
    assertThatThrownBy(() -> PhaseSearch.through(Grid.flat(), FEET, Facing.SOUTH, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
