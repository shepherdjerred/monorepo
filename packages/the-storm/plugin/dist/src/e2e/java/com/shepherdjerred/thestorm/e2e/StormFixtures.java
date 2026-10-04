package com.shepherdjerred.thestorm.e2e;

import java.io.File;
import java.util.Objects;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.WorldType;
import org.bukkit.block.data.Bisected;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.plugin.java.JavaPlugin;

/** Builds only disposable synthetic fixtures from the shipped coordinates. */
public final class StormFixtures extends JavaPlugin {

  private File content;
  private World world;

  @Override
  public void onEnable() {
    if (!"FALSE".equalsIgnoreCase(System.getenv("ONLINE_MODE"))) {
      throw new IllegalStateException("Synthetic fixtures require an offline test server");
    }
    content = new File(getDataFolder().getParentFile(), "TheStorm");
    world = Objects.requireNonNull(getServer().getWorld("world"));
    world.setSpawnLocation(0, 65, 0);
    for (var name : java.util.List.of("wilds", "peaks", "mining")) {
      Objects.requireNonNull(
          new WorldCreator(name).type(WorldType.FLAT).generateStructures(false).createWorld());
    }
    prepareHomes();
    prepareArena();
    prepareAltars();
    prepareSeasonalDoors();
    getLogger().info("Prepared synthetic fixtures for all Storm modules");
  }

  private void prepareHomes() {
    stand(section(yaml("essentials.yml"), "spawn"));
    for (var anchor : yaml("world.yml").getMapList("merchant.anchors")) {
      stand(
          ((Number) anchor.get("x")).doubleValue(),
          ((Number) anchor.get("y")).doubleValue(),
          ((Number) anchor.get("z")).doubleValue());
    }
    prepareNpcs();
    prepareArena();
    prepareAltars();
    prepareSeasonalDoors();
    getLogger().info("Prepared synthetic fixtures for all Storm modules");
    new PlotFixtures(this).register();
  }

  private void prepareNpcs() {
    for (var name : java.util.List.of("spawn", "quest-givers", "watch")) {
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

  private void prepareArena() {
    var arena = yaml("arena/arenas/colosseum.yml");
    var min = section(arena, "region.min");
    var max = section(arena, "region.max");
    for (var x = min.getInt("x") >> 4; x <= max.getInt("x") >> 4; x++) {
      for (var z = min.getInt("z") >> 4; z <= max.getInt("z") >> 4; z++) {
        world.getChunkAt(x, z).setForceLoaded(true);
      }
    }
    for (var name : java.util.List.of("lobby", "spectator", "exit")) {
      stand(section(arena, name));
    }
    for (var name : java.util.List.of("playerSpawns", "mobSpawns")) {
      for (var point : arena.getMapList(name)) {
        stand(
            ((Number) point.get("x")).doubleValue(),
            ((Number) point.get("y")).doubleValue(),
            ((Number) point.get("z")).doubleValue());
      }
    }
    for (var point : arena.getMapList("lootChests")) {
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

  private void prepareAltars() {
    for (var altar : yaml("shards.yml").getMapList("altars")) {
      block(
          ((Number) altar.get("x")).intValue(),
          ((Number) altar.get("y")).intValue(),
          ((Number) altar.get("z")).intValue(),
          Material.valueOf((String) altar.get("material")));
    }
  }

  private void prepareSeasonalDoors() {
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
