package com.shepherdjerred.thestorm.stats.adapter.paper;

import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.stats.app.StatsService;
import com.shepherdjerred.thestorm.stats.domain.CombatClassifier;
import com.shepherdjerred.thestorm.stats.domain.CombatClassifier.CombatActor;
import com.shepherdjerred.thestorm.stats.domain.CombatClassifier.SurvivalContext;
import java.util.Optional;
import org.bukkit.entity.AreaEffectCloud;
import org.bukkit.entity.Boss;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Monster;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.entity.Tameable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.jspecify.annotations.Nullable;

/** Records human survival PvP kills, PvE mob kills/deaths, and environmental deaths. */
public final class StatsCombatListener implements Listener {

  private final StatsService service;
  private final PlayerStateReader stateReader;

  public StatsCombatListener(StatsService service, PlayerStateReader stateReader) {
    this.service = service;
    this.stateReader = stateReader;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onPlayerDeath(PlayerDeathEvent event) {
    var victim = event.getEntity();
    if (!Humans.isHuman(victim)) {
      return;
    }
    var context = new SurvivalContext(stateReader.worldOf(victim), stateReader.inArena(victim));
    if (!context.eligible()) {
      return;
    }
    var victimActor = new CombatActor(victim.getUniqueId(), victim.getName());
    var damage = victim.getLastDamageCause();
    var humanKiller = resolveHumanKiller(victim, damage);
    if (humanKiller.isPresent()) {
      var killer = humanKiller.orElseThrow();
      CombatClassifier.pvp(
              new CombatActor(killer.getUniqueId(), killer.getName()),
              victimActor,
              playerWeapon(killer, damage),
              context)
          .ifPresent(service::recordCombat);
      return;
    }
    if (damage instanceof EntityDamageByEntityEvent byEntity) {
      var mob = resolveNonHumanEntity(byEntity.getDamager());
      if (mob.isPresent() && !mob.orElseThrow().getUniqueId().equals(victim.getUniqueId())) {
        CombatClassifier.pveDeath(
                victimActor, mob.orElseThrow().getType().name(), damagerWeapon(byEntity), context)
            .ifPresent(service::recordCombat);
        return;
      }
    }
    var causeName = damage == null ? "GENERIC_KILL" : damage.getCause().name();
    CombatClassifier.envDeath(victimActor, causeName, context).ifPresent(service::recordCombat);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onEntityDeath(EntityDeathEvent event) {
    var entity = event.getEntity();
    if (entity instanceof Player || !isHostileMob(entity)) {
      return;
    }
    var killer = entity.getKiller();
    if (killer == null || !Humans.isHuman(killer)) {
      return;
    }
    var context = new SurvivalContext(stateReader.worldOf(killer), stateReader.inArena(killer));
    if (!context.eligible()) {
      return;
    }
    CombatClassifier.pveKill(
            new CombatActor(killer.getUniqueId(), killer.getName()),
            entity.getType().name(),
            playerWeapon(killer, entity.getLastDamageCause()),
            context)
        .ifPresent(service::recordCombat);
  }

  private static boolean isHostileMob(Entity entity) {
    return entity instanceof Enemy || entity instanceof Boss || entity instanceof Monster;
  }

  private static Optional<Player> resolveHumanKiller(
      Player victim, @Nullable EntityDamageEvent damage) {
    if (damage instanceof EntityDamageByEntityEvent byEntity) {
      var responsible = responsiblePlayer(byEntity.getDamager());
      if (responsible.isPresent() && Humans.isHuman(responsible.orElseThrow())) {
        return responsible;
      }
    }
    var direct = victim.getKiller();
    if (direct != null && Humans.isHuman(direct)) {
      return Optional.of(direct);
    }
    return Optional.empty();
  }

  private static Optional<Player> responsiblePlayer(Entity damager) {
    if (damager instanceof Player player) {
      return Optional.of(player);
    }
    if (damager instanceof Projectile projectile
        && projectile.getShooter() instanceof Player shooter) {
      return Optional.of(shooter);
    }
    if (damager instanceof Tameable pet && pet.getOwner() instanceof Player owner) {
      return Optional.of(owner);
    }
    if (damager instanceof TNTPrimed tnt && tnt.getSource() instanceof Player lighter) {
      return Optional.of(lighter);
    }
    if (damager instanceof AreaEffectCloud cloud && cloud.getSource() instanceof Player thrower) {
      return Optional.of(thrower);
    }
    return Optional.empty();
  }

  private static Optional<Entity> resolveNonHumanEntity(Entity damager) {
    if (damager instanceof Projectile projectile
        && projectile.getShooter() instanceof Entity shooter) {
      return shooter instanceof Player player && Humans.isHuman(player)
          ? Optional.empty()
          : Optional.of(shooter);
    }
    if (damager instanceof TNTPrimed tnt) {
      var source = tnt.getSource();
      if (source != null) {
        return source instanceof Player player && Humans.isHuman(player)
            ? Optional.empty()
            : Optional.of(source);
      }
    }
    if (damager instanceof Player player && Humans.isHuman(player)) {
      return Optional.empty();
    }
    return Optional.of(damager);
  }

  private static @Nullable String playerWeapon(Player killer, @Nullable EntityDamageEvent damage) {
    if (damage instanceof EntityDamageByEntityEvent byEntity) {
      var indirect = indirectWeapon(byEntity.getDamager());
      if (indirect != null) {
        return indirect;
      }
    }
    var held = killer.getInventory().getItemInMainHand();
    return held.getType().name();
  }

  private static @Nullable String indirectWeapon(Entity damager) {
    if (damager instanceof Projectile projectile) {
      return projectile.getType().name();
    }
    if (damager instanceof TNTPrimed) {
      return "TNT";
    }
    if (damager instanceof AreaEffectCloud) {
      return "SPLASH_POTION";
    }
    if (damager instanceof Tameable pet) {
      return pet.getType().name();
    }
    return null;
  }

  private static String damagerWeapon(EntityDamageByEntityEvent byEntity) {
    if (byEntity.getDamager() instanceof Projectile projectile) {
      return projectile.getType().name();
    }
    return byEntity.getCause().name();
  }
}
