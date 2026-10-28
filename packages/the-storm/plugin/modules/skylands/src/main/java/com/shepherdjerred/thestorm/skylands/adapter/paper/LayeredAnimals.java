package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.LayeredLandscape;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import com.shepherdjerred.thestorm.skylands.domain.SkyRandom;
import java.util.List;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.EntityType;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;

/** Supplements vanilla's top-layer initial mobs with biome-appropriate herds on lower shelves. */
final class LayeredAnimals {
  private final LayeredLandscape landscape;

  LayeredAnimals(LayeredLandscape landscape) {
    this.landscape = landscape;
  }

  void populate(LayeredSlice slice) {
    var x = slice.x() * 16 + 7;
    var z = slice.z() * 16 + 7;
    for (var y : landscape.column(x, z).surfaces(36, 240)) {
      var p = new SkyPosition(x, y + 1, z);
      var hash = SkyRandom.hash(p, landscape.seed() + 2003);
      if (SkyRandom.unit(hash) > 1.0 / 24
          || slice
              .plan()
              .intersects(
                  new com.shepherdjerred.thestorm.skylands.domain.SkyBounds(p, p).expanded(4)))
        continue;
      var biome = slice.region().getBiome(x, y + 1, z).getKey().getKey();
      var types = animals(biome);
      if (types.isEmpty()) continue;
      var type = types.get(Math.floorMod(hash, types.size()));
      for (var n = 0; n < 3; n++)
        spawn(slice, p.add(new SkyPosition(n % 2 * 2, 0, n / 2 * 2)), type);
    }
  }

  private static List<EntityType> animals(String biome) {
    if (biome.contains("mushroom")) return List.of(EntityType.MOOSHROOM);
    if (biome.contains("swamp")) return List.of(EntityType.FROG);
    if (biome.contains("jungle"))
      return List.of(EntityType.PARROT, EntityType.PANDA, EntityType.CHICKEN);
    if (biome.contains("snow") || biome.equals("ice_spikes"))
      return List.of(EntityType.RABBIT, EntityType.POLAR_BEAR, EntityType.GOAT);
    if (biome.contains("taiga")) return List.of(EntityType.WOLF, EntityType.FOX, EntityType.RABBIT);
    if (biome.equals("desert")) return List.of(EntityType.RABBIT);
    if (biome.contains("badlands")
        || biome.contains("caves")
        || biome.equals("deep_dark")
        || biome.equals("pale_garden")) return List.of();
    return List.of(
        EntityType.COW, EntityType.SHEEP, EntityType.PIG, EntityType.CHICKEN, EntityType.HORSE);
  }

  private static void spawn(LayeredSlice slice, SkyPosition p, EntityType type) {
    var ground = slice.region().getType(p.x(), p.y() - 1, p.z());
    if (ground != Material.GRASS_BLOCK
        && ground != Material.MYCELIUM
        && ground != Material.SNOW_BLOCK) return;
    if (!slice.region().getType(p.x(), p.y(), p.z()).isAir()
        || !slice.region().getType(p.x(), p.y() + 1, p.z()).isAir()) return;
    slice
        .region()
        .spawnEntity(
            new Location(slice.region().getWorld(), p.x() + .5, p.y(), p.z() + .5),
            type,
            SpawnReason.CUSTOM);
  }
}
