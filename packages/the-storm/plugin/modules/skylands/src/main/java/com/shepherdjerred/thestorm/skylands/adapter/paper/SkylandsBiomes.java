package com.shepherdjerred.thestorm.skylands.adapter.paper;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.bukkit.block.Biome;
import org.bukkit.generator.BiomeProvider;
import org.bukkit.generator.WorldInfo;

/**
 * Vanilla overworld biomes with the water-only ones (oceans, rivers, beaches) replaced by land
 * biomes, since every island is land. Called from world generation threads; immutable.
 */
final class SkylandsBiomes extends BiomeProvider {

  private final BiomeProvider vanilla;
  private final Map<Biome, Biome> remap;

  SkylandsBiomes(BiomeProvider vanilla, Map<Biome, Biome> remap) {
    this.vanilla = vanilla;
    this.remap = Map.copyOf(remap);
  }

  @Override
  public Biome getBiome(WorldInfo worldInfo, int x, int y, int z) {
    return land(vanilla.getBiome(worldInfo, x, y, z));
  }

  @Override
  public List<Biome> getBiomes(WorldInfo worldInfo) {
    var biomes = new LinkedHashSet<Biome>();
    for (var biome : vanilla.getBiomes(worldInfo)) {
      biomes.add(land(biome));
    }
    return List.copyOf(biomes);
  }

  private Biome land(Biome biome) {
    return remap.getOrDefault(biome, biome);
  }
}
