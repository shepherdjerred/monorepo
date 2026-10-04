package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.entity.LivingEntity;

/** Chooses nearby standable escape destinations; the navigator still has to find a route there. */
final class EscapeRoutes {
  private EscapeRoutes() {}

  static Spot away(Location feet, LivingEntity threat, double distance) {
    var danger = threat.getLocation();
    var direction = Math.atan2(feet.getZ() - danger.getZ(), feet.getX() - danger.getX());
    for (var radius : new double[] {distance, distance / 2}) {
      for (var turn : new double[] {0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2}) {
        var x = (int) Math.floor(feet.getX() + Math.cos(direction + turn) * radius);
        var z = (int) Math.floor(feet.getZ() + Math.sin(direction + turn) * radius);
        var escape =
            standable(feet, x, z)
                .filter(
                    candidate -> candidate.distanceSquared(danger) > feet.distanceSquared(danger));
        if (escape.isPresent()) {
          return spot(escape.get());
        }
      }
    }
    // A trapped civilian stays put and calls the Watch rather than teleporting through a wall.
    return spot(feet);
  }

  private static Optional<Location> standable(Location feet, int x, int z) {
    if (!feet.getWorld().isChunkLoaded(x >> 4, z >> 4)) {
      return Optional.empty();
    }
    for (var offset : new int[] {0, 1, -1, 2, -2}) {
      var y = feet.getBlockY() + offset;
      var block = feet.getWorld().getBlockAt(x, y, z);
      var head = block.getRelative(0, 1, 0);
      if (block.isPassable()
          && !block.isLiquid()
          && head.isPassable()
          && !head.isLiquid()
          && block.getRelative(0, -1, 0).getType().isSolid()) {
        return Optional.of(new Location(feet.getWorld(), x + 0.5, y, z + 0.5));
      }
    }
    return Optional.empty();
  }

  static Spot spot(Location location) {
    return new Spot(
        location.getWorld().getKey().asString(),
        Mannequins.position(location),
        Mannequins.facing(location));
  }
}
