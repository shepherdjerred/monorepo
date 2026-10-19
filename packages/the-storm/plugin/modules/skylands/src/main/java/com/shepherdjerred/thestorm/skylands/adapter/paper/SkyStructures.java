package com.shepherdjerred.thestorm.skylands.adapter.paper;

import java.util.Set;
import org.bukkit.NamespacedKey;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.AsyncStructureGenerateEvent;
import org.bukkit.event.world.AsyncStructureSpawnEvent;
import org.bukkit.generator.structure.Structure;
import org.bukkit.plugin.Plugin;

/**
 * Keeps structures from floating in the skylands' void. Structures that need water, buried terrain
 * or the deep underground are never placed. Every other structure keeps only what lands at or above
 * the island band: a village piece projected over the void lands at the world floor, so it is
 * dropped while the pieces on the island stay.
 *
 * <p>Paper fires both events off the main thread, per chunk a structure spans; the listener and its
 * transformers read only immutable state.
 */
final class SkyStructures implements Listener {

  private final String world;
  private final Set<Structure> blocked;
  private final int floor;
  private final NamespacedKey transformer;

  /**
   * @param plugin owner of the transformer key
   * @param world the skylands world name
   * @param blocked structures never placed
   * @param floor the lowest y a structure block or entity may be placed at
   */
  SkyStructures(Plugin plugin, String world, Set<Structure> blocked, int floor) {
    this.world = world;
    this.blocked = Set.copyOf(blocked);
    this.floor = floor;
    this.transformer = new NamespacedKey(plugin, "skylands_floor");
  }

  @EventHandler(ignoreCancelled = true)
  void onStructureSpawn(AsyncStructureSpawnEvent event) {
    if (event.getWorld().getName().equals(world) && blocked.contains(event.getStructure())) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  void onStructureGenerate(AsyncStructureGenerateEvent event) {
    if (!event.getWorld().getName().equals(world)) {
      return;
    }
    event.setBlockTransformer(
        transformer, (region, x, y, z, current, state) -> y < floor ? state.getWorld() : current);
    event.setEntityTransformer(
        transformer, (region, x, y, z, entity, allowedToSpawn) -> allowedToSpawn && y >= floor);
  }
}
