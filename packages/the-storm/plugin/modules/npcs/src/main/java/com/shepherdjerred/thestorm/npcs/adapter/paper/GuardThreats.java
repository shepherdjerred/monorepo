package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import java.util.Collection;
import java.util.Comparator;
import java.util.Optional;
import java.util.function.Predicate;
import org.bukkit.Location;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;

/** Selects a visible hostile inside both the guard's detection circle and its home area. */
final class GuardThreats {

  private GuardThreats() {}

  record Search(Location feet, Location home, NpcsConfig.Guard guard) {}

  static Optional<Enemy> nearest(
      Collection<Entity> nearby, Search search, Predicate<Enemy> visible) {
    var feet = search.feet();
    var home = search.home();
    var guard = search.guard();
    var homeLimit = guard.homeRadius() * guard.homeRadius();
    var detectionLimit = guard.detectionRadius() * guard.detectionRadius();
    return nearby.stream()
        .filter(Enemy.class::isInstance)
        .map(Enemy.class::cast)
        .filter(enemy -> enemy.isValid() && !enemy.isDead())
        .filter(enemy -> enemy.getLocation().distanceSquared(feet) <= detectionLimit)
        .filter(enemy -> enemy.getLocation().distanceSquared(home) <= homeLimit)
        .filter(visible)
        .min(Comparator.comparingDouble(enemy -> enemy.getLocation().distanceSquared(feet)));
  }
}
