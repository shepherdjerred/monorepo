package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;

final class LayeredTerrainTest {
  @Test
  void adjacentChunksShareTheSameBoundaryDensity() {
    var noise = new LayeredNoise(1731);
    var samples = LayeredNoise.HEIGHT / 4 + 1;
    for (var x = -4; x < 4; x++) {
      var west = noise.density(x * 2, -6);
      var east = noise.density(x * 2 + 2, -6);
      for (var z = 0; z < 3; z++) {
        for (var y = 0; y < samples; y++) {
          assertThat(west[(2 * 3 + z) * samples + y]).isEqualTo(east[z * samples + y]);
        }
      }
    }
  }

  @Test
  void densityHasSeparatedShelvesRatherThanOneHeightmap() {
    var land = new LayeredLandscape(1731);
    var layered = 0;
    var levels = new ArrayList<Integer>();
    for (var x = -96; x <= 96; x += 8) {
      for (var z = -96; z <= 96; z += 8) {
        var surfaces = land.column(x, z).surfaces(-28, 258);
        if (surfaces.size() >= 2) layered++;
        levels.addAll(surfaces);
      }
    }
    assertThat(layered).isGreaterThan(20);
    assertThat(
            levels.stream().mapToInt(Integer::intValue).max().orElseThrow()
                - levels.stream().mapToInt(Integer::intValue).min().orElseThrow())
        .isGreaterThan(120);
  }

  @Test
  void oceanVesselsNeverRemoveTheOriginalIslands() {
    var land = new LayeredLandscape(1731);
    var wet = 0;
    for (var x = 0; x < 512; x += 16) {
      for (var z = 0; z < 512; z += 16) {
        var column = land.column(x, z);
        if (column.ocean() != null && column.ocean().wet()) wet++;
        for (var y = LayeredLandscape.MIN_Y; y < LayeredLandscape.MAX_Y; y++) {
          if (column.original(y)) {
            assertThat(column.solid(y)).isTrue();
            assertThat(column.water(y)).isFalse();
          }
        }
      }
    }
    assertThat(wet).isPositive();
  }

  @Test
  void concurrentDensityIsDeterministicAndSeedSensitive() throws Exception {
    var noise = new LayeredNoise(1731);
    var tasks = new ArrayList<Callable<Integer>>();
    for (var i = 0; i < 24; i++) tasks.add(() -> noise.chunk(-17, 31).fingerprint());
    try (var pool = Executors.newFixedThreadPool(4)) {
      for (var result : pool.invokeAll(tasks)) {
        assertThat(result.get()).isEqualTo(noise.chunk(-17, 31).fingerprint());
      }
    }
    assertThat(new LayeredNoise(90210).chunk(-17, 31).fingerprint())
        .isNotEqualTo(noise.chunk(-17, 31).fingerprint());
  }
}
