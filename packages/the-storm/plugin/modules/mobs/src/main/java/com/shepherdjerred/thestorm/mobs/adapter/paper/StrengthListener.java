package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.mobs.domain.scaling.Rewards;
import com.shepherdjerred.thestorm.mobs.domain.scaling.Stat;
import java.util.random.RandomGenerator;
import org.bukkit.entity.Creeper;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityTransformEvent;

/**
 * The parts of a level attributes cannot carry: stronger projectiles and creeper blasts, rewards
 * for kills a player earned, and keeping levels right when a mob converts into another.
 */
final class StrengthListener implements Listener {

  private final LevelApplier levels;
  private final ExtraLoot loot;
  private final RandomGenerator random;
  private final SealedWorlds sealed;

  StrengthListener(
      LevelApplier levels, ExtraLoot loot, RandomGenerator random, SealedWorlds sealed) {
    this.levels = levels;
    this.sealed = sealed;
    this.loot = loot;
    this.random = random;
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onDamage(EntityDamageByEntityEvent event) {
    if (sealed.isSealed(event.getEntity().getWorld())) {
      return;
    }
    var damager = event.getDamager();
    if (damager instanceof Projectile projectile
        && projectile.getShooter() instanceof LivingEntity shooter) {
      scale(event, shooter, Stat.RANGED_DAMAGE);
    } else if (damager instanceof Creeper creeper) {
      scale(event, creeper, Stat.CREEPER_BLAST);
    }
  }

  private void scale(EntityDamageByEntityEvent event, LivingEntity source, Stat stat) {
    var bonus = levels.bonus(source, stat);
    if (bonus > 0) {
      event.setDamage(event.getDamage() * (1 + bonus));
    }
  }

  /** Keeps the ledger of who hurt each levelled mob, for {@link Rewards#earned}. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onHurt(EntityDamageEvent event) {
    if (sealed.isSealed(event.getEntity().getWorld())
        || !(event.getEntity() instanceof LivingEntity mob)
        || levels.levelOf(mob).isEmpty()) {
      return;
    }
    var byPlayer =
        event instanceof EntityDamageByEntityEvent hit
            && KillLedger.playerHit(hit.getDamager()).isPresent();
    KillLedger.record(mob, byPlayer, Math.min(event.getFinalDamage(), mob.getHealth()));
  }

  /**
   * A kill a player earned pays more experience and extra rolls of the mob's loot table. The drops
   * already listed (including anything the mob picked up) are never touched.
   */
  @EventHandler(priority = EventPriority.HIGH)
  void onDeath(EntityDeathEvent event) {
    var mob = event.getEntity();
    if (sealed.isSealed(mob.getWorld()) || levels.levelOf(mob).isEmpty()) {
      return;
    }
    var killer = KillLedger.finalBlow(event.getDamageSource());
    if (!Rewards.earned(
        KillLedger.playerDamage(mob), KillLedger.otherDamage(mob), killer.isPresent())) {
      return;
    }
    event.setDroppedExp(Rewards.xp(event.getDroppedExp(), levels.bonus(mob, Stat.XP), random));
    var rolls = Rewards.extraRolls(levels.bonus(mob, Stat.ITEM_DROPS), random);
    for (var roll = 0; roll < rolls; roll++) {
      event.getDrops().addAll(loot.roll(mob, killer.orElseThrow()));
    }
  }

  /**
   * A converting mob (a zombie drowning, a skeleton freezing) passes on its name and data. The old
   * nameplate and modifiers go; a hostile result keeps the level with its own type's stats, and
   * split slimes stay vanilla like every split.
   */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onTransform(EntityTransformEvent event) {
    if (sealed.isSealed(event.getEntity().getWorld())
        || !(event.getEntity() instanceof LivingEntity original)) {
      return;
    }
    var level = levels.levelOf(original);
    if (level.isEmpty()) {
      return;
    }
    var inherited = levels.nameplate(original, level.getAsInt());
    var keepLevel = event.getTransformReason() != EntityTransformEvent.TransformReason.SPLIT;
    for (var converted : event.getTransformedEntities()) {
      if (converted instanceof LivingEntity mob) {
        levels.clear(mob, inherited);
        if (keepLevel && mob instanceof Enemy) {
          levels.apply(mob, level.getAsInt());
        }
      }
    }
  }
}
