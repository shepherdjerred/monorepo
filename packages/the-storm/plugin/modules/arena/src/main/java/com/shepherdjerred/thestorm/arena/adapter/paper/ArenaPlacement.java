package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.util.BoundingBox;

/** Bounded collision checks keep scaled bodies and mounts out of entrance walls. */
final class ArenaPlacement {
  private ArenaPlacement() {}

  static boolean collides(LivingEntity entity) {
    return entity.getWorld().hasCollisionsIn(body(entity));
  }

  static boolean ensure(LivingEntity entity, ArenaDefinition arena) {
    if (!collides(entity)) {
      return true;
    }
    return relocate(entity, arena, entity.getLocation());
  }

  static boolean relocate(LivingEntity entity, ArenaDefinition arena, Location preferred) {
    var anchors =
        Stream.concat(
                Stream.of(preferred),
                Stream.concat(
                    arena.playerSpawns().stream()
                        .map(point -> Places.location(entity.getWorld(), point)),
                    arena.mobSpawns().stream()
                        .map(point -> Places.location(entity.getWorld(), point))))
            .toList();
    for (var anchor : anchors) {
      var clear = nearby(entity, arena, anchor);
      if (clear.isPresent()) {
        return entity.teleport(clear.orElseThrow());
      }
    }
    return false;
  }

  private static Optional<Location> nearby(
      LivingEntity entity, ArenaDefinition arena, Location anchor) {
    for (var radius = 0; radius <= 4; radius++) {
      var clear = ring(entity, arena, anchor, radius);
      if (clear.isPresent()) {
        return clear;
      }
    }
    return Optional.empty();
  }

  private static Optional<Location> ring(
      LivingEntity entity, ArenaDefinition arena, Location anchor, int radius) {
    for (var dx = -radius; dx <= radius; dx++) {
      for (var dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) == radius) {
          var clear = column(entity, arena, anchor.clone().add(dx, 0, dz));
          if (clear.isPresent()) {
            return clear;
          }
        }
      }
    }
    return Optional.empty();
  }

  private static Optional<Location> column(
      LivingEntity entity, ArenaDefinition arena, Location column) {
    var world = entity.getWorld();
    for (var dy : List.of(0, 1, -1, 2)) {
      var at = column.clone().add(0, dy, 0);
      var shifted = body(entity).shift(at.toVector().subtract(entity.getLocation().toVector()));
      if (arena.region().contains(Places.point(at))
          && at.clone().add(0, -0.1, 0).getBlock().isCollidable()
          && !world.hasCollisionsIn(shifted)) {
        return Optional.of(at);
      }
    }
    return Optional.empty();
  }

  private static BoundingBox body(LivingEntity entity) {
    var extraHeight = entity.getPassengers().stream().mapToDouble(Entity::getHeight).sum();
    return entity.getBoundingBox().clone().expand(0, 0, 0, 0, extraHeight, 0);
  }
}
