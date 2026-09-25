package com.shepherdjerred.thestorm.world.adapter.paper;

import com.shepherdjerred.thestorm.world.app.ListedWorlds;
import com.shepherdjerred.thestorm.world.app.WildWorld;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import com.shepherdjerred.thestorm.world.domain.WorldConfig;
import com.shepherdjerred.thestorm.world.domain.WorldSpec;
import java.util.ArrayList;
import org.bukkit.GameRules;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.WorldType;

/** Creates configured worlds that are not already loaded, then sets the sleep rule. */
public final class WorldPaper {

  private WorldPaper() {}

  public static WildWorlds install(Server server, WorldConfig config) {
    var loaded = new ArrayList<WildWorld>();
    for (var spec : config.worlds()) {
      var world = load(server, spec);
      var spawn = world.getSpawnLocation();
      loaded.add(new WildWorld(world.getName(), spec.rtp(), spawn.getBlockX(), spawn.getBlockZ()));
    }
    for (var world : server.getWorlds()) {
      if (world.getEnvironment() == World.Environment.NORMAL) {
        world.setGameRule(GameRules.PLAYERS_SLEEPING_PERCENTAGE, config.sleepPercentage());
      }
    }
    return new ListedWorlds(loaded);
  }

  private static World load(Server server, WorldSpec spec) {
    var existing = server.getWorld(spec.name());
    if (existing != null) {
      return existing;
    }
    var created =
        new WorldCreator(spec.name())
            .environment(World.Environment.NORMAL)
            .type(type(spec.preset()))
            .createWorld();
    if (created == null) {
      throw new IllegalStateException("Paper did not create world " + spec.name());
    }
    return created;
  }

  private static WorldType type(String preset) {
    return switch (preset) {
      case "large_biomes" -> WorldType.LARGE_BIOMES;
      case "amplified" -> WorldType.AMPLIFIED;
      default -> throw new IllegalStateException("unknown world preset: " + preset);
    };
  }
}
