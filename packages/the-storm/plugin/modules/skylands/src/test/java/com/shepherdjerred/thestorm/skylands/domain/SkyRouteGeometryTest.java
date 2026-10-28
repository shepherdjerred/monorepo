package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class SkyRouteGeometryTest {
  @Test
  void edgeRouteKeepsVergeAndLampVolumesInsideTheOwningCell() {
    var terrain = new TerrainWindow(new LayeredLandscape(1731));
    var cell = new SkyCell(0, 0);
    var start = new SkyPosition(32, 165, 40);
    var end = new SkyPosition(32, 165, 41);
    var route =
        new SkyRoutes(terrain, cell.interior(), List.of())
            .find(start, Set.of(end), SkyRoutes.Mode.VILLAGE)
            .orElseThrow();
    var edits = new SkyEdits(cell);
    new SkyRouteGeometry(edits, terrain, List.of()).apply(List.of(route), false);
    assertThat(edits.finish())
        .isNotEmpty()
        .allSatisfy(e -> assertThat(cell.interior().contains(e.position())).isTrue());
    assertThat(edits.finish())
        .anyMatch(e -> e.position().equals(start) && e.block().equals("minecraft:air"));
    assertThat(edits.owns(new SkyBounds(start.above(-1), start.above(2)))).isTrue();
    assertThat(edits.owns(new SkyBounds(start.add(new SkyPosition(-1, 0, 0)), start.above(2))))
        .isFalse();
  }
}
