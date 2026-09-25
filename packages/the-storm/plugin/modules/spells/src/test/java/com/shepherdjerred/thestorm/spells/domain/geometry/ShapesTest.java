package com.shepherdjerred.thestorm.spells.domain.geometry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class ShapesTest {

  private static final BlockPos BASE = new BlockPos(10, 64, 10);

  @Test
  void aWallRunsAcrossTheCastersViewCentredOnTheBase() {
    var wall = Shapes.wall(BASE, Facing.NORTH, 3, 2);

    assertThat(wall)
        .containsExactly(
            new BlockPos(11, 64, 10),
            new BlockPos(10, 64, 10),
            new BlockPos(9, 64, 10),
            new BlockPos(11, 65, 10),
            new BlockPos(10, 65, 10),
            new BlockPos(9, 65, 10));
  }

  @Test
  void aWallFacingEastOrWestRunsAlongZ() {
    assertThat(Shapes.wall(BASE, Facing.EAST, 3, 1)).extracting(BlockPos::x).containsOnly(10);
    assertThat(Shapes.wall(BASE, Facing.WEST, 3, 1))
        .extracting(BlockPos::z)
        .containsExactlyInAnyOrder(9, 10, 11);
  }

  @Test
  void anEvenWallLeansToOneSide() {
    assertThat(Shapes.wall(BASE, Facing.SOUTH, 4, 1)).hasSize(4).contains(BASE);
  }

  @Test
  void aTombEnclosesATwoBlockCreatureOnEverySide() {
    var tomb = Shapes.tomb(BASE, 2);

    assertThat(tomb)
        .hasSize(10)
        .contains(BASE.below(), BASE.offset(0, 2, 0), BASE.offset(1, 0, 0), BASE.offset(0, 1, -1))
        .doesNotContain(BASE, BASE.above());
  }

  @Test
  void aPlatformIsAnOddSquare() {
    assertThat(Shapes.platform(BASE, 3)).hasSize(9).contains(BASE, BASE.offset(1, 0, -1));
    assertThat(Shapes.platform(BASE, 1)).containsExactly(BASE);
    assertThatThrownBy(() -> Shapes.platform(BASE, 2)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aBallHoldsEveryBlockWithinTheRadiusNearestFirst() {
    var ball = Shapes.ball(BASE, 2);

    assertThat(ball.getFirst()).isEqualTo(BASE);
    assertThat(ball).allMatch(pos -> pos.distanceSquared(BASE) <= 4);
    assertThat(ball).contains(BASE.offset(0, -2, 0)).doesNotContain(BASE.offset(2, 2, 0));
    assertThat(ball).hasSize(33);
  }

  @Test
  void aCylinderIsBoundedVertically() {
    var cylinder = Shapes.cylinder(BASE, 1, 1, 0);

    assertThat(cylinder).hasSize(10);
    assertThat(cylinder).extracting(BlockPos::y).containsOnly(63, 64);
  }

  @Test
  void shapesRejectNonsense() {
    assertThatThrownBy(() -> Shapes.wall(BASE, Facing.NORTH, 0, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Shapes.tomb(BASE, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Shapes.cylinder(BASE, -1, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
