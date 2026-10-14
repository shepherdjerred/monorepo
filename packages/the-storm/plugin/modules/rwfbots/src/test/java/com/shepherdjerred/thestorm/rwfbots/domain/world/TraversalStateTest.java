package com.shepherdjerred.thestorm.rwfbots.domain.world;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class TraversalStateTest {
  @Test
  void accumulatedFallDistanceIsFiniteNonNegativeAndPreservedExactly() {
    var falling = TraversalState.UNMODIFIED.withFallDistance(4.25);
    assertThat(falling.fallDistance()).isEqualTo(4.25);
    assertThat(falling.withFallDistance(0)).isEqualTo(TraversalState.UNMODIFIED);
    var custom = new TraversalState(false, 5, 0.5, 12, 1, 80, 50, -1, 3, 0, 60, 2, 90, 30, 4.25);
    assertThat(custom.withFallDistance(0).withFallDistance(4.25)).isEqualTo(custom);
    for (var invalid :
        new double[] {-1, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY})
      assertThatThrownBy(() -> TraversalState.UNMODIFIED.withFallDistance(invalid))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("Accumulated fall distance");
  }
}
