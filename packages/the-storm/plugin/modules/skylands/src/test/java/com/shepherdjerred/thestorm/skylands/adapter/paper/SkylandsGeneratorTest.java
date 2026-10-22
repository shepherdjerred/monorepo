package com.shepherdjerred.thestorm.skylands.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.skylands.domain.IslandSpawn;
import com.shepherdjerred.thestorm.skylands.domain.SkyOres;
import com.shepherdjerred.thestorm.skylands.domain.SkyTerrain;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.random.RandomGenerator;
import org.bukkit.HeightMap;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.WorldCreator;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** Structure heights and the spawn follow the islands, not vanilla terrain. */
final class SkylandsGeneratorTest {

  private static final int OFFSET = 64;

  /** Paper's per-chunk random, which the generator never draws from. */
  private static final Random UNUSED = Random.from(RandomGenerator.of("L64X128MixRandom"));

  private final SkyTerrain terrain = new SkyTerrain(1731L);
  private final SkylandsGenerator generator =
      new SkylandsGenerator(
          terrain,
          new SkylandsGenerator.Placement(OFFSET, IslandSpawn.find(terrain, 16).orElseThrow()),
          Map.of(),
          new SkylandsGenerator.Ores(new SkyOres(1731L, List.of()), List.of()));
  private WorldMock world;

  @BeforeEach
  void start() {
    MockBukkit.mock();
    world = new WorldMock(WorldCreator.ofKey(NamespacedKey.minecraft("skylands")));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void baseHeightIsTheFirstAirAboveIslandStone() {
    var checked = 0;
    for (var x = -40; x < 40; x += 3) {
      for (var z = -40; z < 40; z += 3) {
        var top =
            terrain
                .chunk(Math.floorDiv(x, 16), Math.floorDiv(z, 16))
                .top(Math.floorMod(x, 16), Math.floorMod(z, 16));
        var expected = top.isPresent() ? top.getAsInt() + OFFSET + 1 : world.getMinHeight();
        assertThat(generator.getBaseHeight(world, UNUSED, x, z, HeightMap.WORLD_SURFACE_WG))
            .isEqualTo(expected);
        checked += top.isPresent() ? 1 : 0;
      }
    }
    assertThat(checked).isPositive();
  }

  @Test
  void theFixedSpawnStandsOnTheChosenIslandColumn() {
    var spawn = IslandSpawn.find(terrain, 16).orElseThrow();

    var location = generator.getFixedSpawnLocation(world, UNUSED);

    assertThat(location)
        .isEqualTo(
            new Location(world, spawn.x() + 0.5, spawn.top() + OFFSET + 1.0, spawn.z() + 0.5));
    assertThat(
            generator.getBaseHeight(world, UNUSED, spawn.x(), spawn.z(), HeightMap.WORLD_SURFACE))
        .isEqualTo(spawn.top() + OFFSET + 1);
  }

  @Test
  void vanillaRunsEveryStageButNoise() {
    assertThat(generator.shouldGenerateNoise(world, UNUSED, 0, 0)).isFalse();
    assertThat(generator.shouldGenerateSurface(world, UNUSED, 0, 0)).isTrue();
    assertThat(generator.shouldGenerateCaves(world, UNUSED, 0, 0)).isTrue();
    assertThat(generator.shouldGenerateDecorations(world, UNUSED, 0, 0)).isTrue();
    assertThat(generator.shouldGenerateMobs(world, UNUSED, 0, 0)).isTrue();
    assertThat(generator.shouldGenerateStructures(world, UNUSED, 0, 0)).isTrue();
    assertThat(generator.getDefaultPopulators(world)).isEmpty();
  }
}
