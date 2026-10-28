package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.LayeredClimate;
import com.shepherdjerred.thestorm.skylands.domain.LayeredLandscape;
import com.shepherdjerred.thestorm.skylands.domain.LayeredOres;
import com.shepherdjerred.thestorm.skylands.domain.LayeredSites;
import com.shepherdjerred.thestorm.skylands.domain.LayeredSpawn;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import java.util.List;
import java.util.Random;
import org.bukkit.HeightMap;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.generator.BiomeProvider;
import org.bukkit.generator.BlockPopulator;
import org.bukkit.generator.ChunkGenerator;
import org.bukkit.generator.WorldInfo;
import org.bukkit.plugin.Plugin;

/**
 * Production layered world generation. This is a new world format; classic saves require an offline
 * replacement, approved by the server image's pre-start generation guard.
 */
public final class LayeredSkylandsGenerator extends ChunkGenerator {
  private final LayeredLandscape landscape;
  private final LayeredSites sites;
  private final LayeredClimate climate;
  private final LayeredOres ores;
  private final SkyPosition spawn;
  private final LayeredBlocks blocks = new LayeredBlocks();
  private final BiomeProvider biomes;
  private final BlockPopulator population;

  private LayeredSkylandsGenerator(long seed, NativeSkyTemplates templates) {
    landscape = new LayeredLandscape(seed);
    sites = new LayeredSites(landscape, templates.geometry());
    climate = new LayeredClimate(seed);
    ores = new LayeredOres(landscape);
    spawn = LayeredSpawn.find(landscape);
    biomes = new LayeredSkyBiomes(landscape);
    population = new LayeredPopulation(landscape, sites, templates, spawn);
  }

  /** Prepare before WorldCreator runs. Use only with a fresh world directory. */
  public static LayeredSkylandsGenerator create(Plugin plugin, String world, long seed) {
    if (!plugin.getServer().isPrimaryThread())
      throw new IllegalStateException("Load native assets on the main thread");
    var generator = new LayeredSkylandsGenerator(seed, NativeSkyTemplates.load());
    plugin
        .getServer()
        .getPluginManager()
        .registerEvents(new LayeredStructurePolicy(world, generator.sites), plugin);
    return generator;
  }

  public LayeredSites sites() {
    return sites;
  }

  public LayeredLandscape landscape() {
    return landscape;
  }

  /** The selected shelf, also used by the startup lifecycle without drawing randomness. */
  public Location spawnLocation(World world) {
    return new Location(world, spawn.x() + .5, spawn.y(), spawn.z() + .5);
  }

  @Override
  public void generateNoise(WorldInfo info, Random random, int cx, int cz, ChunkData data) {
    for (var x = 0; x < 16; x++) {
      for (var z = 0; z < 16; z++) fillColumn(data, new SkyPosition(cx * 16 + x, 0, cz * 16 + z));
    }
    for (var ore : ores.plan(cx, cz)) {
      var p = ore.position();
      if (data.getType(Math.floorMod(p.x(), 16), p.y(), Math.floorMod(p.z(), 16))
          == Material.STONE) {
        data.setBlock(
            Math.floorMod(p.x(), 16), p.y(), Math.floorMod(p.z(), 16), blocks.get(ore.block()));
      }
    }
  }

  private void fillColumn(ChunkData data, SkyPosition p) {
    var column = landscape.column(p.x(), p.z());
    var depth = 0;
    for (var y = LayeredLandscape.MAX_Y - 1; y >= LayeredLandscape.MIN_Y; y--) {
      if (column.original(y)) {
        set(data, p.above(y), climate.surface(p.above(y), depth));
        depth++;
      } else {
        depth = 0;
        fillSea(data, p.above(y), column);
      }
    }
  }

  private void fillSea(ChunkData data, SkyPosition p, LayeredLandscape.Column column) {
    var sea = column.ocean();
    if (sea != null && p.y() >= sea.bottom() && p.y() <= sea.ground()) {
      var material =
          p.y() == sea.ground() ? "sand" : p.y() >= sea.ground() - 3 ? "sandstone" : "stone";
      set(data, p, material);
    } else if (column.water(p.y())) set(data, p, "water");
  }

  private void set(ChunkData data, SkyPosition p, String name) {
    data.setBlock(
        Math.floorMod(p.x(), 16), p.y(), Math.floorMod(p.z(), 16), blocks.get("minecraft:" + name));
  }

  @Override
  public int getBaseHeight(WorldInfo info, Random random, int x, int z, HeightMap type) {
    var c = landscape.column(x, z);
    var sea = c.ocean();
    if (sea != null && (type == HeightMap.OCEAN_FLOOR || type == HeightMap.OCEAN_FLOOR_WG))
      return sea.ground() + 1;
    for (var y = LayeredLandscape.MAX_Y - 1; y >= LayeredLandscape.MIN_Y; y--) {
      if (c.solid(y) || c.water(y)) return y + 1;
    }
    return info.getMinHeight();
  }

  @Override
  public BiomeProvider getDefaultBiomeProvider(WorldInfo info) {
    return biomes;
  }

  @Override
  public Location getFixedSpawnLocation(World world, Random random) {
    return spawnLocation(world);
  }

  @Override
  public List<BlockPopulator> getDefaultPopulators(World world) {
    return List.of(population);
  }

  @Override
  public boolean shouldGenerateNoise(WorldInfo w, Random r, int x, int z) {
    return false;
  }

  @Override
  public boolean shouldGenerateSurface(WorldInfo w, Random r, int x, int z) {
    return false;
  }

  @Override
  public boolean shouldGenerateCaves(WorldInfo w, Random r, int x, int z) {
    return false;
  }

  @Override
  public boolean shouldGenerateDecorations(WorldInfo w, Random r, int x, int z) {
    return !sites.protectsChunk(x, z);
  }

  @Override
  public boolean shouldGenerateMobs(WorldInfo w, Random r, int x, int z) {
    return true;
  }

  @Override
  public boolean shouldGenerateStructures(WorldInfo w, Random r, int x, int z) {
    return true;
  }
}
