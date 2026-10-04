package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import java.util.Collection;
import java.util.Comparator;
import java.util.Optional;
import java.util.function.Predicate;
import org.bukkit.Location;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;

/** Selects visible threats around an NPC's current position, wherever its routine took it. */
final class GuardThreats {

  private GuardThreats() {}

  record Search(Location feet, NpcsConfig.Guard guard) {}

  record Filters(
      Predicate<LivingEntity> eligible,
      Predicate<LivingEntity> offender,
      Predicate<LivingEntity> visible) {}

  static Optional<LivingEntity> nearest(Collection<Entity> nearby, Search search, Filters filters) {
    var feet = search.feet();
    var guard = search.guard();
    var detectionLimit = guard.detectionRadius() * guard.detectionRadius();
    return nearby.stream()
        .filter(LivingEntity.class::isInstance)
        .map(LivingEntity.class::cast)
        .filter(filters.eligible())
        .filter(enemy -> enemy instanceof Enemy || filters.offender().test(enemy))
        .filter(enemy -> enemy.isValid() && !enemy.isDead())
        .filter(enemy -> enemy.getLocation().distanceSquared(feet) <= detectionLimit)
        .filter(filters.visible())
        .min(
            Comparator.<LivingEntity, Boolean>comparing(enemy -> !filters.offender().test(enemy))
                .thenComparingDouble(enemy -> enemy.getLocation().distanceSquared(feet)));
  }
}
