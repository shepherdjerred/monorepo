package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.LayeredClimate;
import com.shepherdjerred.thestorm.skylands.domain.LayeredLandscape;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Biome;
import org.bukkit.generator.BiomeProvider;
import org.bukkit.generator.WorldInfo;

/** Native 3D biome lookup; ocean and ruin compatibility volumes remain vertically bounded. */
final class LayeredSkyBiomes extends BiomeProvider {
  private static final List<String> KEYS =
      List.of(
          "forest",
          "swamp",
          "plains",
          "pale_garden",
          "birch_forest",
          "cherry_grove",
          "old_growth_pine_taiga",
          "old_growth_spruce_taiga",
          "taiga",
          "mangrove_swamp",
          "bamboo_jungle",
          "jungle",
          "savanna",
          "desert",
          "wooded_badlands",
          "badlands",
          "snowy_taiga",
          "ice_spikes",
          "snowy_plains",
          "mushroom_fields",
          "snowy_slopes",
          "deep_dark",
          "lush_caves",
          "dripstone_caves",
          "snowy_beach",
          "beach",
          "deep_ocean",
          "warm_ocean",
          "deep_cold_ocean",
          "cold_ocean",
          "deep_frozen_ocean",
          "frozen_ocean");
  private final LayeredLandscape landscape;
  private final LayeredClimate climate;
  private final Map<String, Biome> biomes;

  LayeredSkyBiomes(LayeredLandscape landscape) {
    this.landscape = landscape;
    climate = new LayeredClimate(landscape.seed());
    var registry = RegistryAccess.registryAccess().getRegistry(RegistryKey.BIOME);
    var loaded = new HashMap<String, Biome>();
    for (var key : KEYS)
      loaded.put(
          key,
          Objects.requireNonNull(
              registry.get(NamespacedKey.minecraft(key)), "Missing native biome " + key));
    biomes = Map.copyOf(loaded);
  }

  @Override
  public List<Biome> getBiomes(WorldInfo info) {
    return List.copyOf(biomes.values());
  }

  @Override
  public Biome getBiome(WorldInfo info, int x, int y, int z) {
    var p = new SkyPosition(x, y, z);
    return Objects.requireNonNull(biomes.get(climate.biome(p, landscape.column(x, z))));
  }
}
