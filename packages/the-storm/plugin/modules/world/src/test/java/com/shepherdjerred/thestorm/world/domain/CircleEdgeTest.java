package com.shepherdjerred.thestorm.world.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.Test;

final class CircleEdgeTest {

  private final CircleEdge edge = new CircleEdge("map2", 0, 0, 1000);

  @Test
  void theDiscIsRoundNotSquare() {
    assertThat(edge.contains(999, 0)).isTrue();
    assertThat(edge.contains(0, -1000)).isTrue();
    assertThat(edge.contains(800, 800)).as("a square border's corner").isFalse();
    assertThat(edge.contains(700, 700)).isTrue();
  }

  @Test
  void inwardPullsAlongTheRadiusToTheMargin() {
    var column = edge.inward(3000, 4000, 4);
    assertThat(column.x()).isCloseTo(597.6, within(1e-9));
    assertThat(column.z()).isCloseTo(796.8, within(1e-9));
    assertThat(edge.contains(column.x(), column.z())).isTrue();
    assertThat(edge.inward(0, 0, 4)).isEqualTo(new CircleEdge.Column(0, 0));
  }

  @Test
  void aCircleBorderIsOnlyEnforcedWhenTheShapeIsCircle() {
    assertThat(new WorldBorderSpec("map2", 0, 0, 2000, "circle").circle()).contains(edge);
    assertThat(new WorldBorderSpec("frontier", 0, 0, 7000, "square").circle()).isEmpty();
    assertThatThrownBy(() -> edge.inward(1, 1, 1000)).isInstanceOf(IllegalArgumentException.class);
  }
}
