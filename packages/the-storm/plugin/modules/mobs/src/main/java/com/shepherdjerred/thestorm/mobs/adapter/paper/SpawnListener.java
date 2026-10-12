package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.mobs.domain.level.LevelCalculator;
import com.shepherdjerred.thestorm.mobs.domain.level.SpawnSite;
import com.shepherdjerred.thestorm.mobs.domain.spawn.SpawnFacts;
import com.shepherdjerred.thestorm.mobs.domain.spawn.SpawnPolicy;
import com.shepherdjerred.thestorm.mobs.domain.spawn.SpawnVerdict;
import com.shepherdjerred.thestorm.mobs.domain.spawn.Trait;
import io.papermc.paper.world.MoonPhase;
import java.util.EnumSet;
import java.util.random.RandomGenerator;
import org.bukkit.Location;
import org.bukkit.entity.Ageable;
import org.bukkit.entity.Boss;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Tameable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.CreatureSpawnEvent;

/** Levels hostile mobs as they spawn, and stops natural spawns in admin regions if configured. */
final class SpawnListener implements Listener {

  private final SpawnPolicy policy;
  private final LevelCalculator calculator;
  private final LevelApplier applier;
  private final AdminRegionIndex regions;
  private final RandomGenerator random;
  private final SealedWorlds sealed;

  SpawnListener(
      Rules rules, LevelApplier applier, AdminRegionIndex regions, RandomGenerator random) {
    this.policy = rules.policy();
    this.calculator = rules.calculator();
    this.sealed = rules.sealed();
    this.applier = applier;
    this.regions = regions;
    this.random = random;
  }

  /**
   * The pure rules the listener applies.
   *
   * @param policy which mobs are levelled
   * @param calculator what level they get
   * @param sealed worlds no mob is levelled or blocked in
   */
  record Rules(SpawnPolicy policy, LevelCalculator calculator, SealedWorlds sealed) {}

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onSpawn(CreatureSpawnEvent event) {
    var mob = event.getEntity();
    if (sealed.isSealed(mob.getWorld())) {
      return;
    }
    var location = event.getLocation();
    var facts =
        new SpawnFacts(
            LevelApplier.typeKey(mob), event.getSpawnReason().name(), traits(mob, location));
    switch (policy.decide(facts)) {
      case SpawnVerdict.Block() -> event.setCancelled(true);
      case SpawnVerdict.Leave(var _) -> {
        // Vanilla.
      }
      case SpawnVerdict.Level() ->
          calculator
              .level(site(location), random)
              .ifPresent(levelled -> applier.apply(mob, levelled.level()));
    }
  }

  private EnumSet<Trait> traits(LivingEntity mob, Location location) {
    var traits = EnumSet.noneOf(Trait.class);
    if (mob.getPersistentDataContainer().has(MobKeys.ARENA_ENTITY)) {
      traits.add(Trait.ARENA);
    }
    if (mob instanceof Enemy) {
      traits.add(Trait.HOSTILE);
      // Only hostile mobs are ever levelled or blocked, so only they pay for the region lookup.
      if (regions.contains(location)) {
        traits.add(Trait.ADMIN_REGION);
      }
    }
    if (mob instanceof Boss) {
      traits.add(Trait.BOSS);
    }
    if (mob.customName() != null) {
      traits.add(Trait.NAMED);
    }
    if (mob instanceof Tameable tameable && tameable.isTamed()) {
      traits.add(Trait.TAMED);
    }
    if (mob instanceof Ageable ageable && !ageable.isAdult()) {
      traits.add(Trait.BABY);
    }
    return traits;
  }

  private static SpawnSite site(Location location) {
    var world = location.getWorld();
    var spawn = world.getSpawnLocation();
    var distance = Math.hypot(location.getX() - spawn.getX(), location.getZ() - spawn.getZ());
    return new SpawnSite(
        world.getName(),
        distance,
        location.getBlockY(),
        moonPhase(world.getMoonPhase()),
        Math.floorMod(world.getTime(), SpawnSite.DAY));
  }

  /** Minecraft's phase number: 0 is the full moon, 4 the new moon. */
  private static int moonPhase(MoonPhase phase) {
    return switch (phase) {
      case FULL_MOON -> 0;
      case WANING_GIBBOUS -> 1;
      case LAST_QUARTER -> 2;
      case WANING_CRESCENT -> 3;
      case NEW_MOON -> 4;
      case WAXING_CRESCENT -> 5;
      case FIRST_QUARTER -> 6;
      case WAXING_GIBBOUS -> 7;
    };
  }
}
