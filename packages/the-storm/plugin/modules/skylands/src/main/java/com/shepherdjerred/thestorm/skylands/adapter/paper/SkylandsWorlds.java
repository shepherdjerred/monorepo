package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.SkylandsConfig;
import org.bukkit.GameRules;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.plugin.Plugin;

/** Startup lifecycle for the skylands world, which this module alone creates and loads. */
public final class SkylandsWorlds {

  private SkylandsWorlds() {}

  /**
   * Creates or loads the layered world before worlds tick. The image's pre-start guard must approve
   * its saved generation identity first; classic worlds require an offline replacement. Nothing
   * else (Multiverse or bukkit.yml) may load this world before the module.
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
    // Register the layered structure policy before WorldCreator can generate chunks.
    var generator = LayeredSkylandsGenerator.create(plugin, config.world(), config.seed());
    var world = create(server, config, generator);
    placeSpawn(world, generator.spawnLocation(world));
    return world;
  }

  private static World create(
      Server server, SkylandsConfig config, LayeredSkylandsGenerator generator) {
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
              + " but skylands.json declares "
              + config.seed());
    }
    if (world.getMinHeight() != SkylandsConfig.MIN_Y
        || world.getMaxHeight() != SkylandsConfig.MAX_Y) {
      throw new IllegalStateException("Skylands world " + key + " is not overworld height");
    }
    return world;
  }

  /** Keep the selected shelf instead of jumping to the highest island in its column. */
  private static void placeSpawn(World world, Location spawn) {
    var x = spawn.getBlockX();
    var y = spawn.getBlockY();
    var z = spawn.getBlockZ();
    var feet = world.getBlockAt(x, y, z);
    var head = world.getBlockAt(x, y + 1, z);
    if (!world.getBlockAt(x, y - 1, z).getType().isSolid()
        || !feet.isPassable()
        || feet.isLiquid()
        || !head.isPassable()
        || head.isLiquid()) {
      throw new IllegalStateException(
          "Skylands has no safe generated spawn at " + spawn.toVector());
    }
    world.setSpawnLocation(spawn);
    world.setGameRule(GameRules.RESPAWN_RADIUS, 0);
  }
}
