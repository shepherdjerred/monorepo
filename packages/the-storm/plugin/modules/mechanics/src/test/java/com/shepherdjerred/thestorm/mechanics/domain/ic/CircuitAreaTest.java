package com.shepherdjerred.thestorm.mechanics.domain.ic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import org.junit.jupiter.api.Test;

final class CircuitAreaTest {
  @Test
  void theOriginalScalarRadiusUsesTheSupportBlock() {
    var support = new Pos(10, 70, -5);
    assertThat(CircuitArea.parse("30", support, Direction.NORTH))
        .isEqualTo(new CircuitArea(support, new Pos(30, 30, 30)));
  }

  @Test
  void relativeWorldOffsetAndAbsoluteCoordinatesRemainDistinct() {
    var support = new Pos(10, 70, -5);
    assertThat(CircuitArea.parse("1,2,3=2:5:4", support, Direction.EAST).center())
        .isEqualTo(new Pos(14, 75, -3));
    assertThat(CircuitArea.parse("1=&2:5:4", support, Direction.EAST).center())
        .isEqualTo(new Pos(12, 75, -1));
    assertThat(CircuitArea.parse("1=!2:5:4", support, Direction.EAST).center())
        .isEqualTo(new Pos(2, 5, 4));
  }

  @Test
  void missingExternalRegionsAndInvalidCoordinatesAreExplicitProblems() {
    var support = new Pos(10, 70, -5);
    assertThatThrownBy(() -> CircuitArea.parse("r:oldfarm", support, Direction.NORTH))
        .hasMessageContaining("external WorldGuard region");
    assertThatThrownBy(() -> CircuitArea.parse("NaN", support, Direction.NORTH))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
