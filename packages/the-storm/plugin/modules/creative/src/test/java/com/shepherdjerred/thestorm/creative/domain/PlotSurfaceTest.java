package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** Floor, wall, and biome names. Empty stored text is the generator default. */
final class PlotSurfaceTest {

  @Test
  void unknownNamesAreNotStoredAndDefaultsStayEmpty() {
    assertThat(PlotSurface.floor("wool").known()).isFalse();
    assertThat(PlotSurface.wall("wool").known()).isFalse();
    assertThat(PlotSurface.biome("nether").known()).isFalse();

    assertThat(PlotSurface.floor("grass").known()).isTrue();
    assertThat(PlotSurface.floor("grass").stored()).isEmpty();
    assertThat(PlotSurface.wall("stone").stored()).isEmpty();
    assertThat(PlotSurface.biome("plains").stored()).isEmpty();

    assertThat(PlotSurface.floor("sand").stored()).contains("minecraft:sand");
    assertThat(PlotSurface.wall("quartz").stored()).contains("minecraft:quartz_block");
    assertThat(PlotSurface.biome("desert").stored()).contains("minecraft:desert");

    assertThatThrownBy(() -> PlotSurface.requireFloor("minecraft:tnt"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("unknown creative floor");
    assertThatThrownBy(() -> PlotSurface.requireWall("minecraft:tnt"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("unknown creative wall");
    assertThatThrownBy(() -> PlotSurface.requireBiome("minecraft:tnt"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("unknown creative biome");
  }
}
