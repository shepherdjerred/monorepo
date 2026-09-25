package com.shepherdjerred.thestorm.spells.domain.geometry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class SafeSpotsTest {

  private static final BlockPos STAND = new BlockPos(0, 64, 0);

  @Test
  void solidGroundWithTwoOpenBlocksIsSafe() {
    assertThat(SafeSpots.isSafe(Grid.flat(), STAND)).isTrue();
  }

  @Test
  void noGroundIsNotSafe() {
    assertThat(SafeSpots.isSafe(Grid.sky(), STAND)).isFalse();
  }

  @Test
  void aHazardUnderfootAtTheFeetOrAtTheHeadIsNotSafe() {
    assertThat(SafeSpots.isSafe(Grid.flat().set(0, 63, 0, Footing.HAZARD), STAND)).isFalse();
    assertThat(SafeSpots.isSafe(Grid.flat().set(0, 64, 0, Footing.HAZARD), STAND)).isFalse();
    assertThat(SafeSpots.isSafe(Grid.flat().set(0, 65, 0, Footing.HAZARD), STAND)).isFalse();
  }

  @Test
  void aLowCeilingIsNotSafe() {
    assertThat(SafeSpots.isSafe(Grid.flat().set(0, 65, 0, Footing.SOLID), STAND)).isFalse();
  }

  @Test
  void theOriginWinsWhenItIsSafe() {
    assertThat(SafeSpots.nearest(Grid.flat(), STAND, 3)).contains(STAND);
  }

  @Test
  void aDestinationInsideTheGroundResolvesToTheSurfaceAbove() {
    // Aiming at y=63 (the floor itself): y=64 and y=62 are equally near; the higher one wins.
    assertThat(SafeSpots.nearest(Grid.flat(), new BlockPos(0, 63, 0), 3)).contains(STAND);
  }

  @Test
  void aDestinationInMidAirFallsToTheGroundWithinReach() {
    assertThat(SafeSpots.nearest(Grid.flat(), new BlockPos(0, 66, 0), 3)).contains(STAND);
    assertThat(SafeSpots.nearest(Grid.flat(), new BlockPos(0, 70, 0), 3)).isEmpty();
  }

  @Test
  void lavaAtTheDestinationPushesTheArrivalToTheNearestSafeNeighbour() {
    var grid = Grid.flat().set(0, 63, 0, Footing.HAZARD);

    var spot = SafeSpots.nearest(grid, STAND, 2).orElseThrow();
    assertThat(spot.y()).isEqualTo(64);
    assertThat(spot.distanceSquared(STAND)).isEqualTo(1);
    assertThat(SafeSpots.isSafe(grid, spot)).isTrue();
  }

  @Test
  void theVoidIsNeverSafe() {
    assertThat(SafeSpots.nearest(Grid.sky(), new BlockPos(0, 0, 0), 4)).isEmpty();
  }

  @Test
  void radiusZeroChecksOnlyTheOrigin() {
    assertThat(SafeSpots.nearest(Grid.flat(), new BlockPos(0, 65, 0), 0)).isEmpty();
    assertThat(SafeSpots.nearest(Grid.flat(), STAND, 0)).contains(STAND);
    assertThatThrownBy(() -> SafeSpots.nearest(Grid.flat(), STAND, -1))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theSearchIsDeterministic() {
    var grid = Grid.flat().set(0, 63, 0, Footing.HAZARD);

    assertThat(SafeSpots.nearest(grid, STAND, 2)).isEqualTo(SafeSpots.nearest(grid, STAND, 2));
  }
}
