package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

final class PlotMergeTest {

  private final PlotGrid grid = PlotGrid.recovered();
  private final PlotId origin = new PlotId(1, 1);
  private final PlotId east = new PlotId(2, 1);
  private final PlotId north = new PlotId(1, 2);
  private final PlotId diagonal = new PlotId(2, 2);

  @Test
  void adjacentPlotsShareARoadAndADiagonalDoesNot() {
    assertThat(PlotMerge.orthogonal(origin, east)).isTrue();
    assertThat(PlotMerge.orthogonal(origin, north)).isTrue();
    assertThat(PlotMerge.orthogonal(origin, diagonal)).isFalse();
    assertThat(PlotMerge.anchor(List.of(east, origin))).isEqualTo(origin);

    var road = PlotMerge.road(grid, origin, east);
    assertThat(road).isEqualTo(new PlotArea(87, 96, 5, 86));
    assertThat(PlotMerge.touches(List.of(origin), List.of(east))).isTrue();
    assertThat(PlotMerge.touches(List.of(origin), List.of(diagonal))).isFalse();
    assertThat(PlotMerge.touches(List.of(origin), List.of(origin))).isFalse();
  }

  @Test
  void aSelectionMayCoverTheRoadAndNotTheMissingCorner() {
    var pair = PlotMerge.areas(grid, List.of(origin, east));
    var across =
        new BlockBox(
            grid.bounds(origin).minX(),
            64,
            grid.bounds(origin).minZ(),
            grid.bounds(east).maxX(),
            64,
            grid.bounds(origin).maxZ());
    assertThat(PlotMerge.selectionFits(pair, across, 64, 64)).isTrue();
    assertThat(PlotMerge.covers(pair, 87, 45)).isTrue();

    var elbow = PlotMerge.areas(grid, List.of(origin, east, north));
    var outside = new BlockBox(97, 64, 97, 97, 64, 97);
    assertThat(PlotMerge.selectionFits(elbow, outside, 64, 64)).isFalse();
  }

  @Test
  void unlinkAcceptsTheTemplateRoadAndRefusesABuiltBlock() {
    var road = PlotMerge.road(grid, origin, east);
    var band = new PlotFootprint.Band(64, 64);
    PlotFootprint.States expected = (x, y, z) -> "minecraft:glowstone";
    assertThat(PlotRoads.matches(road, band, expected, expected)).isTrue();

    PlotFootprint.States built =
        (x, y, z) ->
            x == road.minX() && y == 64 && z == road.minZ()
                ? "minecraft:diamond_block"
                : "minecraft:glowstone";
    assertThat(PlotRoads.matches(road, band, built, expected)).isFalse();
  }
}
