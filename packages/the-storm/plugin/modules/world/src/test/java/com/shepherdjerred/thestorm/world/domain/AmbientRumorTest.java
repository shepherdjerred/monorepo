package com.shepherdjerred.thestorm.world.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class AmbientRumorTest {

  @Test
  void groundsWeatherInTheObservedMainWorldState() {
    assertThat(AmbientRumor.atSpawn(0, false, false)).contains("sky is clear");
    assertThat(AmbientRumor.atSpawn(0, true, false)).contains("Rain rattles");
    assertThat(AmbientRumor.atSpawn(0, true, true)).contains("Thunder rolls");
    assertThat(AmbientRumor.atSpawn(0, false, true)).contains("Thunder rolls");
  }

  @Test
  void rotatesAnArchiveMemoryByPacificDateWithoutScheduling() {
    assertThat(AmbientRumor.atSpawn(0, false, false)).contains("Storm Shards");
    assertThat(AmbientRumor.atSpawn(1, false, false)).contains("blacksmith");
    assertThat(AmbientRumor.atSpawn(2, false, false)).contains("Braxton");
    assertThat(AmbientRumor.atSpawn(3, false, false)).contains("Twenty-one eggs");
    assertThat(AmbientRumor.atSpawn(4, false, false))
        .isEqualTo(AmbientRumor.atSpawn(0, false, false));
  }
}
