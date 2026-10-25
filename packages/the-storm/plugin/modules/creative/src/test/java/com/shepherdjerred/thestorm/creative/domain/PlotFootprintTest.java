package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Optional;
import org.junit.jupiter.api.Test;

/** Clear uses the generator plus stored choices. Unclaim requires the generator itself. */
final class PlotFootprintTest {

  private static final PlotGrid GRID = PlotGrid.recovered();
  private static final PlotSurface SAND =
      new PlotSurface(
          Optional.of("minecraft:sand"),
          Optional.of("minecraft:quartz_block"),
          Optional.of("minecraft:desert"));

  @Test
  void choicesReplaceOnlyTheSurfaceAndTheTemplateIgnoresThem() {
    assertThat(PlotFootprint.block(GRID, PlotSurface.DEFAULT, at(6, 64, 6)))
        .isEqualTo("minecraft:grass_block");
    assertThat(PlotFootprint.block(GRID, SAND, at(6, 64, 6))).isEqualTo("minecraft:sand");
    assertThat(PlotFootprint.block(GRID, SAND, at(6, 63, 6))).isEqualTo("minecraft:stone");
    assertThat(PlotFootprint.block(GRID, SAND, at(6, 65, 6))).isEqualTo("minecraft:air");
    assertThat(PlotFootprint.block(GRID, SAND, at(5, 64, 5))).isEqualTo("minecraft:quartz_block");
    assertThat(PlotFootprint.block(GRID, SAND, at(5, 65, 45)))
        .isEqualTo("minecraft:stone_brick_slab[type=bottom,waterlogged=false]");
    assertThat(PlotFootprint.block(GRID, SAND, at(0, 64, 0))).isEqualTo("minecraft:air");
    assertThat(PlotFootprint.biome(PlotSurface.DEFAULT)).isEqualTo("minecraft:plains");
    assertThat(PlotFootprint.biome(SAND)).isEqualTo("minecraft:desert");

    var cell = new PlotBounds(new PlotId(1, 1), 6, 6, 6, 6);
    var one = new PlotFootprint.Band(64, 64);
    assertThat(PlotFootprint.matchesTemplate(GRID, cell, one, GRID::generated)).isTrue();
    assertThat(PlotFootprint.matchesTemplate(GRID, cell, one, (x, y, z) -> "minecraft:oak_planks"))
        .isFalse();
    assertThatThrownBy(
            () ->
                PlotFootprint.matchesTemplate(
                    GRID, cell, new PlotFootprint.Band(65, 64), GRID::generated))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("inverted");
  }

  private static PlotFootprint.At at(int x, int y, int z) {
    return new PlotFootprint.At(x, y, z);
  }
}
