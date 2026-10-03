package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.destroystokyo.paper.entity.RangedEntity;
import com.shepherdjerred.thestorm.arena.domain.wave.PursuitWatch;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;
import org.bukkit.entity.Creaking;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;

/** Retries stalled navigation, then returns unreachable mobs to a floor entrance. */
final class ColosseumPursuit {
  private final PursuitWatch watch = new PursuitWatch();

  void tick(ArenaWorld world, List<Player> fighters, Instant now) {
    var enemies = world.enemies();
    watch.retain(
        enemies.stream().map(e -> e.getUniqueId()).collect(Collectors.toUnmodifiableSet()));
    if (fighters.isEmpty()) {
      return;
    }
    for (var enemy : enemies) {
      if (!(enemy instanceof Mob mob) || enemy.getVehicle() != null) {
        continue;
      }
      if (ArenaPlacement.collides(enemy)) {
        ArenaPlacement.ensure(enemy, world.definition());
      }
      var target =
          fighters.stream()
              .min(
                  Comparator.comparingDouble(
                      p -> Places.at(p).distanceSquared(enemy.getLocation())))
              .orElseThrow();
      var distance = Places.at(target).distanceSquared(enemy.getLocation());
      var ranged = mob instanceof RangedEntity || mob instanceof Creaking;
      var fighting = mob.hasLineOfSight(target) && (distance <= 9 || (ranged && distance <= 256));
      switch (watch.observe(
          enemy.getUniqueId(), Places.point(enemy.getLocation()), now, fighting)) {
        case NONE -> {}
        case RETRY -> mob.getPathfinder().moveTo(target, 1.0);
        case RELOCATE -> {
          var entrance =
              world.definition().playerSpawns().stream()
                  .min(
                      Comparator.comparingDouble(
                          p ->
                              Places.location(world.world(), p).distanceSquared(Places.at(target))))
                  .orElseThrow();
          ArenaPlacement.relocate(
              enemy, world.definition(), Places.location(world.world(), entrance));
          mob.getPathfinder().moveTo(target, 1.0);
        }
      }
    }
  }

  void reset() {
    watch.reset();
  }
}
