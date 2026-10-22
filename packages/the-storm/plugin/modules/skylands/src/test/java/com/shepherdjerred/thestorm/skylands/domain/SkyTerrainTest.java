package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

final class SkyTerrainTest {

  /** One chunk of upstream output: its first and 151st density samples, stone volume and hash. */
  record Upstream(
      long seed, int chunkX, int chunkZ, int volume, long hash, double first, double sampled) {}

  /**
   * Values produced by the unmodified upstream OldGenerator classes (NoiseGeneratorOctaves173,
   * NoiseGeneratorPerlin173 and ChunkProviderSky173's terrain methods, run with java.util.Random)
   * for the same seeds and chunks. The port must match Beta 1.7.3 block for block.
   */
  static Stream<Upstream> upstream() {
    return Stream.of(
        new Upstream(
            -8_675_309L,
            -40,
            17,
            2375,
            -4236240268734402830L,
            -33.616160390405405,
            -14.875238167024413),
        new Upstream(0L, 0, 0, 4753, -7824592624600065994L, -38.8803810429521, -10.238278791860953),
        new Upstream(
            12_345L, 0, 0, 7861, -9209278201326625862L, -37.520946171808184, -12.592463823256367),
        new Upstream(
            12_345L, 5, -3, 7988, 2151371078773180129L, -37.924903903271186, -27.124021516119615));
  }

  @MethodSource("upstream")
  @ParameterizedTest
  void matchesUpstreamBetaTerrain(Upstream expected) {
    var terrain = new SkyTerrain(expected.seed());

    var density = terrain.density(expected.chunkX() * 2, expected.chunkZ() * 2);
    var chunk = terrain.chunk(expected.chunkX(), expected.chunkZ());

    assertThat(density[0]).isEqualTo(expected.first());
    assertThat(density[150]).isEqualTo(expected.sampled());
    assertThat(chunk.volume()).isEqualTo(expected.volume());
    assertThat(hash(chunk)).isEqualTo(expected.hash());
  }

  @Test
  void theSameSeedAndChunkAlwaysGiveTheSameStone() {
    var first = new SkyTerrain(1731L);
    var second = new SkyTerrain(1731L);

    for (var chunkX = -3; chunkX <= 3; chunkX++) {
      for (var chunkZ = -3; chunkZ <= 3; chunkZ++) {
        assertThat(hash(second.chunk(chunkX, chunkZ))).isEqualTo(hash(first.chunk(chunkX, chunkZ)));
        assertThat(hash(first.chunk(chunkX, chunkZ))).isEqualTo(hash(first.chunk(chunkX, chunkZ)));
      }
    }
  }

  @Test
  void differentSeedsGiveDifferentIslands() {
    assertThat(hash(new SkyTerrain(1L).chunk(0, 0)))
        .isNotEqualTo(hash(new SkyTerrain(2L).chunk(0, 0)));
  }

  @Test
  void stoneStaysInsideBetasIslandBand() {
    var terrain = new SkyTerrain(1731L);
    for (var chunkX = -4; chunkX < 4; chunkX++) {
      for (var chunkZ = -4; chunkZ < 4; chunkZ++) {
        var chunk = terrain.chunk(chunkX, chunkZ);
        for (var x = 0; x < 16; x++) {
          for (var z = 0; z < 16; z++) {
            assertThat(chunk.solid(x, 0, z)).isFalse();
            assertThat(chunk.solid(x, SkyTerrain.HEIGHT - 1, z)).isFalse();
          }
        }
      }
    }
  }

  @Test
  void concurrentGenerationMatchesSequentialGeneration() throws Exception {
    var terrain = new SkyTerrain(1731L);
    var chunks = new ArrayList<int[]>();
    for (var chunkX = -8; chunkX < 8; chunkX++) {
      for (var chunkZ = -8; chunkZ < 8; chunkZ++) {
        chunks.add(new int[] {chunkX, chunkZ});
      }
    }
    var sequential = new ArrayList<Long>();
    for (var chunk : chunks) {
      sequential.add(hash(terrain.chunk(chunk[0], chunk[1])));
    }

    var tasks = new ArrayList<Callable<Long>>();
    for (var round = 0; round < 4; round++) {
      for (var chunk : chunks) {
        tasks.add(() -> hash(terrain.chunk(chunk[0], chunk[1])));
      }
    }
    List<Future<Long>> results;
    try (var pool = Executors.newFixedThreadPool(8)) {
      results = pool.invokeAll(tasks);
    }

    for (var i = 0; i < results.size(); i++) {
      assertThat(results.get(i).get()).isEqualTo(sequential.get(i % chunks.size()));
    }
  }

  /** FNV-1a over the chunk in Beta's x, z, y block order. */
  static long hash(IslandChunk chunk) {
    var hash = 0xcbf29ce484222325L;
    for (var x = 0; x < 16; x++) {
      for (var z = 0; z < 16; z++) {
        for (var y = 0; y < SkyTerrain.HEIGHT; y++) {
          hash ^= chunk.solid(x, y, z) ? 1 : 0;
          hash *= 0x100000001b3L;
        }
      }
    }
    return hash;
  }
}
