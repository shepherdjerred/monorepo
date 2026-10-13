package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig;
import java.util.random.RandomGenerator;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.WorldType;

/** Startup lifecycle for RWF's owned lobby; restored match terrain must already be loaded. */
public final class RwfWorlds {

  private static final String VOID_PRESET =
      "{\"layers\":[{\"block\":\"minecraft:air\",\"height\":1}],\"biome\":\"minecraft:the_void\"}";

  private RwfWorlds() {}

  /**
   * Requires the map world before creating or loading the declared owned lobby. Paper owns all
   * world storage. Existing lobby terrain is retained; only the authored room is later verified and
   * repaired by RWF. Call during plugin startup, before the server starts ticking worlds.
   */
  public static World prepare(
      Server server, RwfConfig.Worlds config, SealedWorlds sealed, RandomGenerator random) {
    if (!server.isPrimaryThread()) {
      throw new IllegalStateException(
          "Owned RWF lobby preparation requires the primary server thread");
    }
    if (server.getWorld(config.maps()) == null) {
      throw new IllegalStateException(
          "rwf.yml names map world "
              + config.maps()
              + ", which must be provisioned and loaded before rwf");
    }
    var key = NamespacedKey.minecraft(config.lobby());
    var world = server.getWorld(config.lobby());
    if (world == null) {
      requireCreationWindow(server);
    }
    // World creation fires world-load listeners synchronously, so protect the name first.
    var wasSealed = sealed.isSealed(config.lobby());
    sealed.seal(config.lobby());
    try {
      if (world == null) {
        world =
            switch (config.lobbyProvisioning()) {
              case OWNED_VOID ->
                  server.createWorld(
                      WorldCreator.ofKey(key)
                          .environment(World.Environment.NORMAL)
                          .type(WorldType.FLAT)
                          .generatorSettings(VOID_PRESET)
                          .generateStructures(false)
                          .seed(random.nextLong()));
            };
      }
      if (world == null) {
        throw new IllegalStateException("Paper could not create or load owned RWF lobby " + key);
      }
      if (!world.getName().equals(config.lobby()) || !world.getKey().equals(key)) {
        throw new IllegalStateException("Owned RWF lobby identity does not match " + key);
      }
      if (world.getEnvironment() != World.Environment.NORMAL) {
        throw new IllegalStateException("Owned RWF lobby " + key + " must be NORMAL");
      }
      return world;
    } catch (RuntimeException failure) {
      if (!wasSealed) {
        sealed.unseal(config.lobby());
      }
      throw failure;
    }
  }

  private static void requireCreationWindow(Server server) {
    if (server.isTickingWorlds()) {
      throw new IllegalStateException(
          "Owned RWF lobby creation must run before worlds start ticking");
    }
  }
}
