package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.IslandSpawn;
import com.shepherdjerred.thestorm.skylands.domain.SkyOres;
import com.shepherdjerred.thestorm.skylands.domain.SkyTerrain;
import com.shepherdjerred.thestorm.skylands.domain.SkylandsConfig;
import com.shepherdjerred.thestorm.skylands.domain.SpawnColumn;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.bukkit.GameRules;
import org.bukkit.HeightMap;
import org.bukkit.Keyed;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.block.Biome;
import org.bukkit.block.data.BlockData;
import org.bukkit.generator.structure.Structure;
import org.bukkit.plugin.Plugin;

/** Startup lifecycle for the skylands world, which this module alone creates and loads. */
public final class SkylandsWorlds {

  private SkylandsWorlds() {}

  /**
   * Creates the skylands world, or loads it from disk, with the Skylands generator, and places its
   * spawn on island ground. Call during plugin startup, before the server starts ticking worlds.
   * The world must not already be loaded: anything that loaded it first (Multiverse, bukkit.yml)
   * would have generated it without this generator.
   */
  public static World install(Plugin plugin, SkylandsConfig config) {
    var server = plugin.getServer();
    if (!server.isPrimaryThread()) {
      throw new IllegalStateException("Skylands world creation requires the primary server thread");
    }
    if (server.getWorld(config.world()) != null) {
      throw new IllegalStateException(
          "World "
              + config.world()
              + " was loaded before the skylands module; only TheStorm may load it");
    }
    if (server.isTickingWorlds()) {
      throw new IllegalStateException("Skylands world creation must run before worlds tick");
    }
    var terrain = new SkyTerrain(config.seed());
    var spawn =
        IslandSpawn.find(terrain, config.spawnSearchChunks())
            .orElseThrow(
                () ->
                    new IllegalStateException(
                        "No island ground within "
                            + config.spawnSearchChunks()
                            + " chunks of the origin for seed "
                            + config.seed()));
    var generator =
        new SkylandsGenerator(
            terrain,
            new SkylandsGenerator.Placement(config.verticalOffset(), spawn),
            biomeRemap(config),
            new SkylandsGenerator.Ores(
                new SkyOres(config.seed(), config.ores()), oreBlocks(config)));
    // Structures start generating as soon as the world is created, so filter them first.
    server
        .getPluginManager()
        .registerEvents(
            new SkyStructures(
                plugin, config.world(), blockedStructures(config), config.verticalOffset()),
            plugin);
    var world = create(server, config, generator);
    placeSpawn(world, config, spawn);
    return world;
  }

  private static World create(Server server, SkylandsConfig config, SkylandsGenerator generator) {
    var key = NamespacedKey.minecraft(config.world());
    var world =
        server.createWorld(
            WorldCreator.ofKey(key)
                .environment(World.Environment.NORMAL)
                .seed(config.seed())
                .generator(generator)
                .generateStructures(true));
    if (world == null) {
      throw new IllegalStateException("Paper could not create or load the skylands world " + key);
    }
    if (!world.getName().equals(config.world()) || !world.getKey().equals(key)) {
      throw new IllegalStateException("Skylands world identity does not match " + key);
    }
    if (world.getGenerator() != generator) {
      throw new IllegalStateException("Skylands world " + key + " is not using its generator");
    }
    if (world.getSeed() != config.seed()) {
      throw new IllegalStateException(
          "Skylands world "
              + key
              + " has seed "
              + world.getSeed()
              + " but skylands.yml declares "
              + config.seed());
    }
    if (world.getMinHeight() != SkylandsConfig.MIN_Y
        || world.getMaxHeight() != SkylandsConfig.MAX_Y) {
      throw new IllegalStateException("Skylands world " + key + " is not overworld height");
    }
    return world;
  }

  /**
   * Generates the spawn chunk and stands the spawn on whatever vanilla placed over the chosen stone
   * (grass, snow, a tree). Respawn spreading is off: around the spawn is mostly void.
   */
  private static void placeSpawn(World world, SkylandsConfig config, SpawnColumn spawn) {
    var surface = world.getHighestBlockYAt(spawn.x(), spawn.z(), HeightMap.MOTION_BLOCKING);
    if (surface < config.verticalOffset()) {
      throw new IllegalStateException(
          "Skylands spawn column "
              + spawn.x()
              + ","
              + spawn.z()
              + " has no ground after generation");
    }
    world.setSpawnLocation(spawn.x(), surface + 1, spawn.z());
    world.setGameRule(GameRules.RESPAWN_RADIUS, 0);
  }

  private static Map<Biome, Biome> biomeRemap(SkylandsConfig config) {
    var biomes = RegistryAccess.registryAccess().getRegistry(RegistryKey.BIOME);
    var remap = new HashMap<Biome, Biome>();
    for (var entry : config.biomeRemap().entrySet()) {
      remap.put(
          resolve(biomes, "biome", entry.getKey()), resolve(biomes, "biome", entry.getValue()));
    }
    return remap;
  }

  /** The block each configured ore vein places; an unknown key fails startup. */
  private static List<BlockData> oreBlocks(SkylandsConfig config) {
    var types = RegistryAccess.registryAccess().getRegistry(RegistryKey.BLOCK);
    var blocks = new ArrayList<BlockData>();
    for (var vein : config.ores()) {
      blocks.add(resolve(types, "ore block", vein.block()).createBlockData());
    }
    return blocks;
  }

  private static Set<Structure> blockedStructures(SkylandsConfig config) {
    var structures = RegistryAccess.registryAccess().getRegistry(RegistryKey.STRUCTURE);
    var blocked = new HashSet<Structure>();
    for (var key : config.blockedStructures()) {
      blocked.add(resolve(structures, "structure", key));
    }
    return blocked;
  }

  private static <T extends Keyed> T resolve(Registry<T> registry, String kind, String key) {
    var namespaced = NamespacedKey.fromString(key);
    var value = namespaced == null ? null : registry.get(namespaced);
    if (value == null) {
      throw new IllegalStateException("skylands.yml names unknown " + kind + " " + key);
    }
    return value;
  }
}
