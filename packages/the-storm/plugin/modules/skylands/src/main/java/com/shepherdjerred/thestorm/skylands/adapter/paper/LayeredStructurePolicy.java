package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.LayeredLandscape;
import com.shepherdjerred.thestorm.skylands.domain.LayeredSites;
import com.shepherdjerred.thestorm.skylands.domain.SkyBounds;
import com.shepherdjerred.thestorm.skylands.domain.SkyCell;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.Objects;
import java.util.Set;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.AsyncStructureSpawnEvent;

/** Filters vanilla layouts before they can replace density or collide with generated districts. */
final class LayeredStructurePolicy implements Listener {
  private final String world;
  private final LayeredSites sites;
  private static final Set<String> UNDERGROUND =
      Set.of("ancient_city", "trial_chambers", "stronghold");

  LayeredStructurePolicy(String world, LayeredSites sites) {
    this.world = world;
    this.sites = sites;
  }

  @EventHandler(ignoreCancelled = true)
  void structure(AsyncStructureSpawnEvent event) {
    if (!event.getWorld().getName().equals(world)) return;
    var key =
        Objects.requireNonNull(
                RegistryAccess.registryAccess()
                    .getRegistry(RegistryKey.STRUCTURE)
                    .getKey(event.getStructure()))
            .getKey();
    if (key.startsWith("village_")
        || key.startsWith("mineshaft")
        || UNDERGROUND.contains(key)
        || event.getBoundingBox().getMinY() < LayeredLandscape.MIN_Y) {
      event.setCancelled(true);
      return;
    }
    var b = event.getBoundingBox();
    var bounds =
        new SkyBounds(
            new SkyPosition((int) b.getMinX(), (int) b.getMinY(), (int) b.getMinZ()),
            new SkyPosition((int) b.getMaxX(), (int) b.getMaxY(), (int) b.getMaxZ()));
    if (overlapsDistrict(bounds)) event.setCancelled(true);
  }

  private boolean overlapsDistrict(SkyBounds bounds) {
    var first =
        SkyCell.atChunk(Math.floorDiv(bounds.min().x(), 16), Math.floorDiv(bounds.min().z(), 16));
    var last =
        SkyCell.atChunk(Math.floorDiv(bounds.max().x(), 16), Math.floorDiv(bounds.max().z(), 16));
    for (var x = first.x(); x <= last.x(); x++) {
      for (var z = first.z(); z <= last.z(); z++) {
        if (sites.plan(new SkyCell(x, z)).intersects(bounds)) return true;
      }
    }
    return false;
  }
}
