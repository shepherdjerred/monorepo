package com.shepherdjerred.thestorm.creative.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

/** The shipped template's block states parse on a server registry. */
final class CreativeGeneratorTest {

  @BeforeEach
  void start() {
    MockBukkit.mock();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void theShippedTemplateParsesAndLeavesVanillaStagesOff() {
    var generator = CreativeGenerator.open(PlotGrid.recovered());

    assertThat(generator.shouldGenerateNoise()).isFalse();
    assertThat(generator.shouldGenerateSurface()).isFalse();
    assertThat(generator.shouldGenerateCaves()).isFalse();
    assertThat(generator.shouldGenerateDecorations()).isFalse();
    assertThat(generator.shouldGenerateMobs()).isFalse();
    assertThat(generator.shouldGenerateStructures()).isFalse();
  }
}
