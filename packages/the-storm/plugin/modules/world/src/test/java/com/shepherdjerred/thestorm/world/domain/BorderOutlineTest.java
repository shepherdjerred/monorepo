package com.shepherdjerred.thestorm.world.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

final class BorderOutlineTest {

  @Test
  void aSquareBorderIsItsNativeCorners() {
    var outline = BorderOutline.of(new WorldBorderSpec("world_nether", 100, -50, 6000, "square"));
    assertThat(outline.world()).isEqualTo("world_nether");
    assertThat(outline.points())
        .containsExactly(
            new BorderOutline.Point(-2900, -3050),
            new BorderOutline.Point(3100, -3050),
            new BorderOutline.Point(3100, 2950),
            new BorderOutline.Point(-2900, 2950));
  }

  @Test
  void aCircleBorderIsDrawnOnTheDiscPlayersStayInside() {
    var spec = new WorldBorderSpec("map2", 0, 0, 24000, "circle");
    var outline = BorderOutline.of(spec);
    var edge = spec.circle().orElseThrow();
    assertThat(outline.points()).hasSize(BorderOutline.CIRCLE_VERTICES);
    for (var point : outline.points()) {
      assertThat(Math.hypot(point.x(), point.z())).isCloseTo(12000, within(1e-6));
      assertThat(edge.contains(point.x() * 0.9999, point.z() * 0.9999)).isTrue();
    }
    // Chords between neighbouring vertices stay within two blocks of the edge.
    var first = outline.points().get(0);
    var second = outline.points().get(1);
    var middle = Math.hypot((first.x() + second.x()) / 2, (first.z() + second.z()) / 2);
    assertThat(12000 - middle).isLessThan(2);
  }

  @Test
  void anOutlineNeedsAPolygon() {
    assertThatThrownBy(
            () ->
                new BorderOutline(
                    "world", List.of(new BorderOutline.Point(0, 0), new BorderOutline.Point(1, 1))))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
