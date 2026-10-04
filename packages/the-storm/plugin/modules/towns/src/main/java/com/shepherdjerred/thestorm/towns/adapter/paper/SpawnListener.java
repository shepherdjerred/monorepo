package com.shepherdjerred.thestorm.towns.adapter.paper;

import static java.util.stream.Collectors.toUnmodifiableSet;

import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import java.util.Arrays;
import java.util.Set;
import java.util.TreeSet;
import org.bukkit.entity.Enemy;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.CreatureSpawnEvent;

/**
 * Admin regions that limit spawns let only their listed spawn reasons spawn creatures, so the arena
 * holds only the waves the arena module spawns.
 */
final class SpawnListener implements Listener {

  private final Guard guard;

  SpawnListener(Guard guard) {
    this.guard = guard;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onSpawn(CreatureSpawnEvent event) {
    var land = guard.land(event.getLocation());
    if (land.preventsPlayerDamage() && event.getEntity() instanceof Enemy) {
      event.setCancelled(true);
      return;
    }
    if (land instanceof Land.RegionLand(var region)
        && !region.mobSpawns().allows(event.getSpawnReason().name())) {
      event.setCancelled(true);
    }
  }

  /**
   * Every spawn reason {@code towns.yml} names must be one Paper knows: a typo would never match.
   */
  static void requireSpawnReasons(TownsConfig config) {
    Set<String> known =
        Arrays.stream(CreatureSpawnEvent.SpawnReason.values())
            .map(Enum::name)
            .collect(toUnmodifiableSet());
    var unknown = new TreeSet<String>();
    config
        .regions()
        .forEach(
            region ->
                region.mobSpawns().allow().stream()
                    .filter(reason -> !known.contains(reason))
                    .forEach(unknown::add));
    if (!unknown.isEmpty()) {
      throw new IllegalStateException(
          "towns.yml names spawn reasons Paper does not have: " + String.join(", ", unknown));
    }
  }
}
