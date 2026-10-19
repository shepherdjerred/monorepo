package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

final class SkyOresTest {

  private static final List<OreVein> VEINS =
      List.of(
          new OreVein("minecraft:diamond_ore", 8, 6, 16, 48),
          new OreVein("minecraft:redstone_ore", 12, 8, 16, 60));

  private final SkyTerrain terrain = new SkyTerrain(1731L);
  private final SkyOres ores = new SkyOres(1731L, VEINS);

  @Test
  void oresOnlyReplaceStoneBelowTheSoilLayer() {
    var placed = 0;
    for (var chunkX = -6; chunkX < 6; chunkX++) {
      for (var chunkZ = -6; chunkZ < 6; chunkZ++) {
        var chunk = terrain.chunk(chunkX, chunkZ);
        for (var ore : ores.plan(chunkX, chunkZ, chunk)) {
          assertThat(ore.x()).isBetween(0, 15);
          assertThat(ore.z()).isBetween(0, 15);
          assertThat(chunk.solid(ore.x(), ore.y(), ore.z())).isTrue();
          assertThat(ore.y())
              .isLessThanOrEqualTo(
                  chunk.top(ore.x(), ore.z()).orElseThrow() - SkyOres.SURFACE_DEPTH);
          assertThat(ore.vein()).isBetween(0, VEINS.size() - 1);
          placed++;
        }
      }
    }
    assertThat(placed).isPositive();
  }

  @Test
  void theSameSeedAndChunkPlanTheSameOres() {
    var compared = 0;
    for (var chunkX = -6; chunkX < 6; chunkX++) {
      for (var chunkZ = -6; chunkZ < 6; chunkZ++) {
        compared += samePlanForSameSeed(chunkX, chunkZ) ? 1 : 0;
      }
    }
    assertThat(compared).isPositive();
  }

  /** Checks one chunk; true when it holds ore, so a different seed must plan differently. */
  private boolean samePlanForSameSeed(int chunkX, int chunkZ) {
    var chunk = terrain.chunk(chunkX, chunkZ);
    var plan = ores.plan(chunkX, chunkZ, chunk);
    assertThat(new SkyOres(1731L, VEINS).plan(chunkX, chunkZ, chunk)).isEqualTo(plan);
    if (plan.isEmpty()) {
      return false;
    }
    assertThat(new SkyOres(1732L, VEINS).plan(chunkX, chunkZ, chunk)).isNotEqualTo(plan);
    return true;
  }

  @Test
  void theVoidGetsNoOre() {
    var empty = new IslandChunk(new boolean[16 * 16 * SkyTerrain.HEIGHT]);

    assertThat(ores.plan(0, 0, empty)).isEmpty();
  }

  @Test
  void veinsAreValidated() {
    assertThatThrownBy(() -> new OreVein("diamond_ore", 1, 1, 0, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new OreVein("minecraft:diamond_ore", 0, 1, 0, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new OreVein("minecraft:diamond_ore", 1, 1, 50, 40))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new OreVein("minecraft:diamond_ore", 1, 1, 0, SkyTerrain.HEIGHT))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
