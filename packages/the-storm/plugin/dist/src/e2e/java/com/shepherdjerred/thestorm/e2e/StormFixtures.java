package com.shepherdjerred.thestorm.e2e;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.WorldType;
import org.bukkit.block.data.Bisected;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Builds only disposable synthetic fixtures from the shipped coordinates, for the modules the
 * staged config.yml switches on. The full suite enables everything; the e2e suite enables a few
 * modules and needs only their fixtures (and must not move the main world's spawn into the air).
 */
public final class StormFixtures extends JavaPlugin {

  /** A flat world with no terrain at all: the rwf maps bring their own. */
  private static final String VOID_PRESET =
      "{\"layers\":[{\"block\":\"minecraft:air\",\"height\":1}],\"biome\":\"minecraft:the_void\"}";

  private File content;
  private World world;

  @Override
  public void onEnable() {
    if (!"FALSE".equalsIgnoreCase(System.getenv("ONLINE_MODE"))) {
      throw new IllegalStateException("Synthetic fixtures require an offline test server");
    }
    content = new File(getDataFolder().getParentFile(), "TheStorm");
    com.shepherdjerred.thestorm.arena.adapter.paper.ArenaFixtures.install(this, content.toPath());
    RepeaterFixtures.install(this);
    world = Objects.requireNonNull(getServer().getWorld("world"));
    var modules = section(yaml("config.yml"), "modules");
    var prepared = new ArrayList<String>();
    if (enabled(modules, "world", prepared)) {
      worldFixtures();
    }
    if (enabled(modules, "essentials", prepared)) {
      world.setSpawnLocation(0, 65, 0);
      stand(section(yaml("essentials.yml"), "spawn"));
    }
    if (enabled(modules, "npcs", prepared)) {
      npcFixtures();
    }
    if (enabled(modules, "arena", prepared)) {
      arenaFixtures();
      prepareSettlement();
    }
    if (enabled(modules, "shards", prepared)) {
      shardFixtures();
    }
    if (enabled(modules, "seasonal", prepared)) {
      seasonalFixtures();
    }
    if (enabled(modules, "rwf", prepared)) {
      rwfWorld();
    }
    getLogger().info("Prepared synthetic fixtures for Storm modules " + prepared);
    new PlotFixtures(this).register();
  }

  /** Whether {@code module} is switched on; a config that omits it is a staging bug. */
  private static boolean enabled(ConfigurationSection modules, String module, List<String> on) {
    if (!modules.isBoolean(module)) {
      throw new IllegalStateException("config.yml does not list module " + module);
    }
    if (modules.getBoolean(module)) {
      on.add(module);
      return true;
    }
    return false;
  }

  private void worldFixtures() {
    for (var name : List.of("wilds", "peaks", "mining")) {
      Objects.requireNonNull(
          new WorldCreator(name).type(WorldType.FLAT).generateStructures(false).createWorld());
    }
    for (var anchor : yaml("world.yml").getMapList("merchant.anchors")) {
      stand(
          ((Number) anchor.get("x")).doubleValue(),
          ((Number) anchor.get("y")).doubleValue(),
          ((Number) anchor.get("z")).doubleValue());
    }
  }

  private void npcFixtures() {
    for (var name : List.of("spawn", "quest-givers", "watch")) {
      var npcs = yaml("npcs/" + name + ".yml");
      var homes = section(npcs, "npcs");
      for (var id : homes.getKeys(false)) {
        stand(section(homes, id + ".home"));
      }
      var places = section(npcs, "places");
      for (var id : places.getKeys(false)) {
        stand(section(places, id));
      }
    }
  }

  private void arenaFixtures() {
    var arena = yaml("arena/arenas/colosseum.yml");
    var min = section(arena, "region.min");
    var max = section(arena, "region.max");
    for (var x = min.getInt("x") >> 4; x <= max.getInt("x") >> 4; x++) {
      for (var z = min.getInt("z") >> 4; z <= max.getInt("z") >> 4; z++) {
        world.getChunkAt(x, z).setForceLoaded(true);
      }
    }
    colosseumFloor(min, max);
    for (var name : List.of("lobby", "spectator", "exit")) {
      stand(section(arena, name));
    }
    for (var name : List.of("playerSpawns", "mobSpawns")) {
      for (var point : arena.getMapList(name)) {
        stand(
            ((Number) point.get("x")).doubleValue(),
            ((Number) point.get("y")).doubleValue(),
            ((Number) point.get("z")).doubleValue());
      }
    }
    for (var point : arena.getMapList("lootChests")) {
      var x = ((Number) point.get("x")).intValue();
      var y = ((Number) point.get("y")).intValue();
      var z = ((Number) point.get("z")).intValue();
      chestPlatform(x, y, z);
      stand(
          ((Number) point.get("x")).doubleValue() + .5,
          ((Number) point.get("y")).doubleValue() + 1,
          ((Number) point.get("z")).doubleValue() + .5);
      block(
          ((Number) point.get("x")).intValue(),
          ((Number) point.get("y")).intValue(),
          ((Number) point.get("z")).intValue(),
          Material.CHEST);
    }
    var signs = section(arena, "classSigns");
    for (var id : signs.getKeys(false)) {
      var point = section(signs, id);
      block(point.getInt("x"), point.getInt("y"), point.getInt("z"), Material.OAK_WALL_SIGN);
    }
    var ready = section(arena, "readyBlock");
    block(ready.getInt("x"), ready.getInt("y"), ready.getInt("z"), Material.IRON_BLOCK);
  }

  private void colosseumFloor(ConfigurationSection min, ConfigurationSection max) {
    // The disposable flat world is far below the saved arena's floor.
    for (var x = min.getInt("x"); x <= max.getInt("x"); x++) {
      for (var z = min.getInt("z"); z <= max.getInt("z"); z++) {
        block(x, 40, z, Material.STONE);
      }
    }
  }

  private void chestPlatform(int x, int y, int z) {
    // Give the interacting player a platform beside the raised chest.
    for (var dx = -1; dx <= 1; dx++) {
      for (var dz = -1; dz <= 1; dz++) {
        block(x + dx, y, z + dz, Material.STONE);
      }
    }
  }

  private void prepareSettlement() {
    var survival =
        com.shepherdjerred.thestorm.core.config.ConfigFiles.load(
            content.toPath().resolve("arena/survival.yml"),
            com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent.class);
    prepareSurvival(survival);
    var rustworks =
        com.shepherdjerred.thestorm.core.config.ConfigFiles.load(
                content.toPath().resolve("arena/rustworks.yml"),
                com.shepherdjerred.thestorm.arena.domain.survival.SurvivalMapContent.class)
            .withRules(survival);
    prepareSurvival(rustworks);
  }

  private void prepareSurvival(
      com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent survival) {
    var arenaWorld =
        Objects.requireNonNull(
            new WorldCreator(survival.arena().world())
                .type(WorldType.FLAT)
                .generatorSettings(VOID_PRESET)
                .generateStructures(false)
                .createWorld());
    arenaWorld.setSpawnLocation(
        (int) Math.floor(survival.arena().lobby().x()),
        (int) survival.arena().lobby().y(),
        (int) Math.floor(survival.arena().lobby().z()));
    arenaWorld.setDifficulty(org.bukkit.Difficulty.NORMAL);
    com.shepherdjerred.thestorm.arena.domain.survival.SurvivalBlueprint.blocks(survival)
        .forEach(
            (pos, material) -> {
              arenaWorld.getChunkAt(pos.x() >> 4, pos.z() >> 4).setForceLoaded(true);
              arenaWorld
                  .getBlockAt(pos.x(), pos.y(), pos.z())
                  .setBlockData(
                      material.startsWith("minecraft:")
                          ? org.bukkit.Bukkit.createBlockData(material)
                          : Material.valueOf(material).createBlockData(),
                      false);
            });
  }

  private void shardFixtures() {
    for (var altar : yaml("shards.yml").getMapList("altars")) {
      block(
          ((Number) altar.get("x")).intValue(),
          ((Number) altar.get("y")).intValue(),
          ((Number) altar.get("z")).intValue(),
          Material.valueOf((String) altar.get("material")));
    }
  }

  private void seasonalFixtures() {
    for (var event : yaml("seasonal.yml").getMapList("events")) {
      // Bukkit exposes nested YAML lists as maps; reload each event as a section.
      var config = new YamlConfiguration();
      event.forEach((key, value) -> config.set(key.toString(), value));
      for (var door : config.getMapList("doors")) {
        var x = ((Number) door.get("east")).intValue();
        var y = 65 + ((Number) door.get("up")).intValue();
        var z = ((Number) door.get("south")).intValue();
        var material = Material.valueOf((String) door.get("material"));
        block(x, y - 1, z, Material.STONE);
        for (var half : Bisected.Half.values()) {
          var data = (org.bukkit.block.data.type.Door) material.createBlockData();
          data.setHalf(half);
          world.getBlockAt(x, y + (half == Bisected.Half.TOP ? 1 : 0), z).setBlockData(data, false);
        }
      }
    }
  }

  /**
   * The world rwf.yml names, as an operator would provision it through Multiverse: flat and empty,
   * loaded before TheStorm enables so the module can seal it and paste its maps.
   */
  private void rwfWorld() {
    var name = Objects.requireNonNull(yaml("rwf.yml").getString("world"), "rwf.yml world");
    Objects.requireNonNull(
        new WorldCreator(name)
            .type(WorldType.FLAT)
            .generatorSettings(VOID_PRESET)
            .generateStructures(false)
            .createWorld());
  }

  private YamlConfiguration yaml(String path) {
    var file = new File(content, path);
    if (!file.isFile()) {
      throw new IllegalStateException("Missing fixture source " + file);
    }
    return YamlConfiguration.loadConfiguration(file);
  }

  private static ConfigurationSection section(ConfigurationSection parent, String key) {
    return Objects.requireNonNull(parent.getConfigurationSection(key), key);
  }

  private void stand(ConfigurationSection point) {
    stand(point.getDouble("x"), point.getDouble("y"), point.getDouble("z"));
  }

  private void stand(double x, double y, double z) {
    var bx = (int) Math.floor(x);
    var by = (int) Math.floor(y);
    var bz = (int) Math.floor(z);
    block(bx, by - 1, bz, Material.STONE);
    block(bx, by, bz, Material.AIR);
    block(bx, by + 1, bz, Material.AIR);
  }

  private void block(int x, int y, int z, Material material) {
    world.getChunkAt(x >> 4, z >> 4).setForceLoaded(true);
    world.getBlockAt(x, y, z).setType(material, false);
  }
}
