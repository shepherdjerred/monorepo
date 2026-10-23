package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class PlotGridTest {

  private final PlotGrid grid = PlotGrid.recovered();

  @Test
  void theOriginCrossingIsRoadAndPlotOneIsTheSouthEastSquare() {
    assertThat(grid.plotAt(0, 0)).isEmpty();
    assertThat(grid.columnAt(0, 0)).isEqualTo(PlotColumn.ROAD);
    assertThat(grid.plotAt(-1, -1)).isEmpty();

    var plot = grid.plotAt(5, 5).orElseThrow();
    assertThat(plot.text()).isEqualTo("1;1");
    assertThat(grid.bounds(plot)).isEqualTo(new PlotBounds(plot, 5, 86, 5, 86));
    assertThat(grid.columnAt(5, 5)).isEqualTo(PlotColumn.WALL);
    assertThat(grid.columnAt(6, 6)).isEqualTo(PlotColumn.FLOOR);
    assertThat(grid.columnAt(86, 86)).isEqualTo(PlotColumn.WALL);
    assertThat(grid.plotAt(87, 87)).isEmpty();
  }

  @Test
  void negativeCellsUseTruncatingPlotIds() {
    var wall = grid.plotAt(-6, -6).orElseThrow();
    assertThat(wall.text()).isEqualTo("0;0");
    assertThat(grid.columnAt(-6, -6)).isEqualTo(PlotColumn.WALL);
    assertThat(grid.bounds(wall)).isEqualTo(new PlotBounds(wall, -87, -6, -87, -6));

    assertThat(grid.columnAt(-87, -87)).isEqualTo(PlotColumn.WALL);
    assertThat(grid.plotAt(-87, -87).orElseThrow().text()).isEqualTo("0;0");
    assertThat(grid.plotAt(-88, -88)).isEmpty();
    assertThat(grid.columnAt(-88, 0)).isEqualTo(PlotColumn.ROAD);

    var west = grid.plotAt(-99, -99).orElseThrow();
    assertThat(west.text()).isEqualTo("-1;-1");
    assertThat(grid.bounds(west)).isEqualTo(new PlotBounds(west, -179, -98, -179, -98));
  }

  @Test
  void anExactNegativeCellBoundaryStaysInsideTheCell() {
    assertThat(grid.cellX(0)).isZero();
    assertThat(grid.cellX(92)).isZero();
    assertThat(grid.cellX(-92)).isZero();
    assertThat(grid.cellX(-87)).isEqualTo(5);
    assertThat(grid.cellX(-6)).isEqualTo(86);
    assertThat(grid.columnAt(-92, -92)).isEqualTo(PlotColumn.ROAD);
  }

  @Test
  void homeIsTheCenterColumnStandingOnTheSurface() {
    var east = new PlotId(1, 1);
    assertThat(grid.home(east)).isEqualTo(new PlotGrid.PlotHome(45.5, PlotGrid.SPAWN_Y, 45.5));
    assertThat(grid.columnAt(45, 45)).isEqualTo(PlotColumn.FLOOR);

    var origin = new PlotId(0, 0);
    assertThat(grid.home(origin)).isEqualTo(new PlotGrid.PlotHome(-46.5, PlotGrid.SPAWN_Y, -46.5));
    assertThat(grid.columnAt(-47, -47)).isEqualTo(PlotColumn.FLOOR);
    assertThat(grid.home(origin).y()).isEqualTo(PlotGrid.SURFACE_Y + 1d);
  }

  @Test
  void theProceduralColumnIsBedrockFillAndAGrassFloor() {
    assertThat(grid.generated(0, 0, 0)).isEqualTo("minecraft:bedrock");
    assertThat(grid.generated(0, 4, 0)).isEqualTo("minecraft:quartz_block");
    assertThat(grid.generated(10, 4, 10)).isEqualTo("minecraft:stone");
    assertThat(grid.generated(6, 64, 6)).isEqualTo("minecraft:grass_block");
    assertThat(grid.generated(5, 64, 5)).isEqualTo("minecraft:stone");
    assertThat(grid.generated(5, 65, 45))
        .isEqualTo("minecraft:stone_brick_slab[type=bottom,waterlogged=false]");
    assertThat(grid.generated(0, 64, 0)).isEqualTo("minecraft:air");
    assertThat(grid.generated(0, -1, 0)).isEqualTo("minecraft:air");
    assertThat(grid.generated(-7, 64, -7)).isEqualTo("minecraft:grass_block");
    assertThat(grid.generated(-5, 4, 0)).isEqualTo("minecraft:quartz_block");
  }
}
