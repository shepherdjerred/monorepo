package com.shepherdjerred.thestorm.shards.domain;

import static com.shepherdjerred.thestorm.shards.domain.Fixtures.OVERWORLD;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class AltarTest {

  @Test
  void rainInAPlainsBiomeTurnsTheWindmill() {
    // Plains: temperature 0.8, downfall 0.4.
    assertThat(new AltarSky(true, true, 0.8, 0.4).raining()).isTrue();
  }

  @Test
  void clearSkiesDoNot() {
    assertThat(new AltarSky(true, false, 0.8, 0.4).raining()).isFalse();
  }

  @Test
  void snowIsNotRain() {
    // Snowy plains, or a mountain top above the snow line.
    assertThat(new AltarSky(true, true, 0.0, 0.5).raining()).isFalse();
    assertThat(new AltarSky(true, true, 0.1499, 0.5).raining()).isFalse();
    assertThat(new AltarSky(true, true, AltarSky.SNOW_BELOW, 0.5).raining()).isTrue();
  }

  @Test
  void dryBiomesNeverRain() {
    // Desert and savanna have no precipitation, and zero downfall.
    assertThat(new AltarSky(true, true, 2.0, 0.0).raining()).isFalse();
  }

  @Test
  void theNetherAndEndNeverRainEvenWhenTheOverworldDoes() {
    assertThat(new AltarSky(false, true, 0.5, 0.5).raining()).isFalse();
  }

  @Test
  void altarsMatchTheirExactBlock() {
    var windmill = new AltarLocation(OVERWORLD, -71, 74, -243);

    assertThat(windmill.isAt(OVERWORLD, -71, 74, -243)).isTrue();
    assertThat(windmill.isAt(OVERWORLD, -71, 75, -243)).isFalse();
    assertThat(windmill.isAt(OVERWORLD, -70, 74, -243)).isFalse();
    assertThat(windmill.isAt(OVERWORLD, -71, 74, -242)).isFalse();
    assertThat(windmill.isAt("minecraft:the_nether", -71, 74, -243)).isFalse();
  }

  @ParameterizedTest
  @CsvSource({"world", "Minecraft:Overworld", "''"})
  void altarWorldsAreNamespacedKeys(String world) {
    assertThatThrownBy(() -> new AltarLocation(world, 0, 64, 0))
        .hasMessageContaining("namespaced key");
  }
}
