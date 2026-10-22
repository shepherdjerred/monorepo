package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class IslandSpawnTest {

  @Test
  void findsThickLevelGroundNearTheOrigin() {
    var terrain = new SkyTerrain(1731L);

    var spawn = IslandSpawn.find(terrain, 16).orElseThrow();

    var chunk = terrain.chunk(Math.floorDiv(spawn.x(), 16), Math.floorDiv(spawn.z(), 16));
    var x = Math.floorMod(spawn.x(), 16);
    var z = Math.floorMod(spawn.z(), 16);
    assertThat(chunk.top(x, z)).hasValue(spawn.top());
    assertThat(chunk.depthBelow(x, spawn.top(), z)).isGreaterThanOrEqualTo(IslandSpawn.MIN_DEPTH);
    assertThat(Math.max(Math.abs(spawn.x()), Math.abs(spawn.z()))).isLessThan(17 * 16);
  }

  @Test
  void theSearchIsDeterministic() {
    assertThat(IslandSpawn.find(new SkyTerrain(42L), 16))
        .isEqualTo(IslandSpawn.find(new SkyTerrain(42L), 16));
  }

  @Test
  void aZeroRingSearchOnlyConsidersTheOriginChunk() {
    var spawn = IslandSpawn.find(new SkyTerrain(12345L), 0);

    assertThat(spawn)
        .hasValueSatisfying(
            column -> {
              assertThat(column.x()).isBetween(0, 15);
              assertThat(column.z()).isBetween(0, 15);
            });
  }
}
