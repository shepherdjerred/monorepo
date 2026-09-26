package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.mobs.domain.scaling.Rewards;
import com.shepherdjerred.thestorm.mobs.domain.scaling.Stat;
import java.util.random.RandomGenerator;
import org.bukkit.entity.Creeper;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDeathEvent;

/**
 * The parts of a level attributes cannot carry: stronger projectiles and creeper blasts, and larger
 * experience and drops when a player kills the mob.
 */
final class StrengthListener implements Listener {

  private final LevelApplier levels;
  private final RandomGenerator random;

  StrengthListener(LevelApplier levels, RandomGenerator random) {
    this.levels = levels;
    this.random = random;
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onDamage(EntityDamageByEntityEvent event) {
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

  /** Only kills by players pay more, so mob farms that kill by fall or lava stay vanilla. */
  @EventHandler(priority = EventPriority.HIGH)
  void onDeath(EntityDeathEvent event) {
    var mob = event.getEntity();
    if (mob.getKiller() == null || levels.levelOf(mob).isEmpty()) {
      return;
    }
    event.setDroppedExp(Rewards.xp(event.getDroppedExp(), levels.bonus(mob, Stat.XP), random));
    var dropBonus = levels.bonus(mob, Stat.ITEM_DROPS);
    for (var drop : event.getDrops()) {
      drop.setAmount(
          Rewards.dropAmount(drop.getAmount(), drop.getMaxStackSize(), dropBonus, random));
    }
  }
}
