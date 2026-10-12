package com.shepherdjerred.thestorm.towns.adapter.paper;

import static java.nio.charset.StandardCharsets.UTF_8;

import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import com.shepherdjerred.thestorm.towns.domain.region.BlockCorner;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.shepherdjerred.thestorm.towns.domain.region.RegionAllowance;
import com.shepherdjerred.thestorm.towns.domain.region.RegionAreas;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import com.shepherdjerred.thestorm.towns.domain.region.RegionSpawns;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.SpawnChangeEvent;
import org.bukkit.event.world.WorldLoadEvent;

/** Protects every loaded world's arrival, including regenerated resource worlds. */
final class SpawnRegions implements Listener {

  private final Server server;
  private final TownsState state;
  private final TownsConfig config;

  SpawnRegions(Server server, TownsState state, TownsConfig config) {
    this.server = server;
    this.state = state;
    this.config = config;
    refresh();
  }

  @EventHandler
  void onLoad(WorldLoadEvent event) {
    refresh();
  }

  @EventHandler
  void onSpawn(SpawnChangeEvent event) {
    refresh();
  }

  private void refresh() {
    var regions = new ArrayList<>(config.regions());
    for (var world : server.getWorlds()) {
      var spawn = world.getSpawnLocation();
      var areas = new ArrayList<Cuboid>();
      areas.add(arrival(world, spawn.getBlockX(), spawn.getBlockZ()));
      // Vanilla End portals arrive at the generated obsidian platform, independently of spawn.
      if (world.getEnvironment() == World.Environment.THE_END) {
        areas.add(arrival(world, 100, 0));
      }
      regions.add(
          new AdminRegion(
              "arrival_" + world.getUID().toString().replace("-", "").substring(0, 24),
              world.getName() + " arrival",
              new RegionAreas(List.of(), areas),
              List.of(
                  new RegionAllowance(
                      Action.INTERACT,
                      Set.of(
                          Subject.DOOR,
                          Subject.TRAPDOOR,
                          Subject.FENCE_GATE,
                          Subject.BUTTON,
                          Subject.LEVER,
                          Subject.PRESSURE_PLATE,
                          Subject.TRIPWIRE,
                          Subject.BELL)),
                  new RegionAllowance(
                      Action.INTERACT_ENTITY, Set.of(Subject.VILLAGER, Subject.VEHICLE)),
                  new RegionAllowance(Action.OPEN_CONTAINER, Set.of(Subject.CONTAINER)),
                  new RegionAllowance(Action.TELEPORT_INTO, Set.of(Subject.LOCATION))),
              new RegionSpawns(true, Set.of("CUSTOM", "COMMAND")),
              RegionProfile.SAFE));
    }
    state
        .parcels()
        .ifPresent(
            book ->
                book.definitions()
                    .forEach(
                        def ->
                            regions.add(
                                new AdminRegion(
                                    "holding_"
                                        + UUID.nameUUIDFromBytes(def.id().getBytes(UTF_8))
                                            .toString()
                                            .replace("-", "")
                                            .substring(0, 24),
                                    def.name(),
                                    new RegionAreas(List.of(), List.of(def.area())),
                                    List.of(),
                                    RegionSpawns.unlimited(),
                                    RegionProfile.PRESERVE))));
    state.replaceRegions(new RegionIndex(regions));
  }

  private Cuboid arrival(World world, int x, int z) {
    var radius = config.spawnRadiusBlocks();
    return new Cuboid(
        world.getName(),
        new BlockCorner(x - radius, world.getMinHeight(), z - radius),
        new BlockCorner(x + radius, world.getMaxHeight() - 1, z + radius));
  }
}
