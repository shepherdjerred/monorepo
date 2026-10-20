package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.ByteBuffer;
import org.junit.jupiter.api.Test;

final class PlotTemplateTest {

  @Test
  void theShippedTableStampsTheMeasuredRoadAndLeavesPlotFloorsAlone() throws IOException {
    var grid = PlotGrid.recovered();
    var template = PlotTemplate.decode(grid, resource());

    assertThat(template.stateAt(0, 64, 0)).isEqualTo("minecraft:glowstone");
    assertThat(template.stateAt(45, 64, 0)).isEqualTo("minecraft:glowstone");
    assertThat(template.stateAt(91, 64, 0)).isEqualTo("minecraft:glowstone");
    assertThat(template.stateAt(-92, 64, 0)).isEqualTo("minecraft:glowstone");
    assertThat(template.stateAt(0, 0, 0)).isEqualTo("minecraft:bedrock");
    assertThat(template.stateAt(0, 4, 0)).isEqualTo("minecraft:quartz_block");
    assertThat(template.stateAt(10, 4, 10)).isEqualTo("minecraft:stone");
    assertThat(template.stateAt(6, 64, 6)).isEqualTo("minecraft:grass_block");
    assertThat(template.stateAt(5, 64, 5)).isEqualTo("minecraft:stone");
    assertThat(template.stateAt(5, 65, 45))
        .isEqualTo("minecraft:stone_brick_slab[type=bottom,waterlogged=false]");
    assertThat(template.stateAt(-6, 64, -6)).isEqualTo("minecraft:stone");
    assertThat(template.stateAt(-7, 64, -7)).isEqualTo("minecraft:grass_block");
    assertThat(template.stateAt(-5, 4, 0)).isEqualTo("minecraft:quartz_block");
    assertThat(template.stateAt(20, 80, 20)).isEqualTo("minecraft:air");
  }

  @Test
  void aTableForAnotherCellSizeIsRefused() {
    var otherSize = ByteBuffer.allocate(11);
    otherSize.put(new byte[] {'C', 'P', 'L', 'T', 1});
    otherSize.putShort((short) 1);
    otherSize.putShort((short) 0);
    otherSize.putShort((short) 0);

    assertThatThrownBy(() -> PlotTemplate.decode(PlotGrid.recovered(), otherSize.array()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("grid");
    assertThatThrownBy(() -> PlotTemplate.decode(PlotGrid.recovered(), new byte[] {'C', 'P'}))
        .isInstanceOf(Exception.class);
  }

  private static byte[] resource() throws IOException {
    try (var in = PlotTemplate.class.getResourceAsStream("/creative-template.bin")) {
      assertThat(in).isNotNull();
      return in.readAllBytes();
    }
  }
}
