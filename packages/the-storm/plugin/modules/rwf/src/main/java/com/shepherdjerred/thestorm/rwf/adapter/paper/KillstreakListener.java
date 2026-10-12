// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/killstreak/
// StreakBase.java and streaks/*.java, and the summons' targeting and damage through
// redwarfare-arcade/src/me/libraryaddict/arcade/managers/EventManager.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.Optional;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.IronGolem;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityTargetEvent;
import org.bukkit.event.player.PlayerInteractEvent;

/**
 * Killstreak items in a player's hand, the blocks delivering them, the supply crates they open,
 * napalm's fire and the summons fighting: each turned into what {@link Killstreaks}, {@link Napalm}
 * and {@link Summons} do. The server's own use of a killstreak item (placing the TNT, hatching the
 * egg) is always denied. Main thread only.
 */
final class KillstreakListener implements Listener {

  private final MatchRunner runner;
  private final PaperContext context;

  KillstreakListener(MatchRunner runner, PaperContext context) {
    this.runner = runner;
    this.context = context;
  }

  private Killstreaks streaks() {
    return runner.powers().streaks();
  }

  /**
   * A supply crate opened, or a killstreak item used: Red Warfare heard both hands, and any click
   * on a block (the compass any click at all), unless something else already denied the item.
   */
  @EventHandler(priority = EventPriority.HIGH)
  void onInteract(PlayerInteractEvent event) {
    if (event.getAction() == Action.PHYSICAL) {
      return;
    }
    var player = event.getPlayer();
    var block = Optional.ofNullable(event.getClickedBlock());
    var denied = event.useItemInHand() == Event.Result.DENY;
    if (event.getAction() == Action.RIGHT_CLICK_BLOCK
        && block.isPresent()
        && streaks().loot(player, block.orElseThrow())) {
      deny(event);
    }
    var item = event.getItem();
    if (item == null || denied || !streaks().use(player, item, block, event.getBlockFace())) {
      return;
    }
    deny(event);
  }

  private static void deny(PlayerInteractEvent event) {
    event.setUseItemInHand(Event.Result.DENY);
    event.setUseInteractedBlock(Event.Result.DENY);
  }

  /** A delivery landed: the reward arrives, and the falling block never becomes a block. */
  @EventHandler(priority = EventPriority.HIGHEST)
  void onLand(EntityChangeBlockEvent event) {
    var entity = event.getEntity();
    if (streaks().isFalling(entity)) {
      event.setCancelled(true);
      streaks().land(entity, Places.at(entity));
    }
  }

  /** A summon never takes anyone dead, or of its own team. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onTarget(EntityTargetEvent event) {
    var summon = streaks().summons().of(event.getEntity());
    if (summon.isPresent()
        && !streaks().summons().mayTarget(summon.orElseThrow(), event.getTarget())) {
      event.setCancelled(true);
    }
  }

  /**
   * A summon's blow, and a fighter's blow on a summon, go through the combat rules instead of the
   * server's; nobody hurts a summon of their own team, and summons leave the dead, their own team
   * and decorations alone.
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.LOW)
  void onDamage(EntityDamageByEntityEvent event) {
    var summons = streaks().summons();
    var by = summons.of(event.getDamager());
    if (by.isPresent()) {
      event.setCancelled(true);
      if (event.getEntity() instanceof LivingEntity victim
          && !(victim instanceof ArmorStand)
          && runner.live()
          && summons.alive(victim)
          && summons.teamOf(victim).filter(by.orElseThrow().team()::equals).isEmpty()
          && summons.strike(by.orElseThrow(), victim)
          && by.orElseThrow().mob() instanceof IronGolem golem) {
        summons.landed(golem);
      }
      return;
    }
    var hurt = summons.of(event.getEntity());
    var attacker = CombatListener.responsible(event.getDamager());
    if (hurt.isEmpty() || attacker.isEmpty()) {
      return;
    }
    var player = attacker.orElseThrow();
    var attackerTeam = runner.memberOf(player.getUniqueId()).flatMap(member -> member.team());
    if (attackerTeam.filter(hurt.orElseThrow().team()::equals).isPresent()) {
      event.setCancelled(true);
      return;
    }
    if (!runner.fighting(player.getUniqueId())) {
      return;
    }
    event.setCancelled(true);
    if (event.getCause() != EntityDamageEvent.DamageCause.ENTITY_SWEEP_ATTACK) {
      summons.struck(player, event.getDamager(), hurt.orElseThrow(), event.getDamage());
    }
  }

  /**
   * Napalm's fire on a fighter burns as napalm, credited to its thrower, through the combat rules,
   * for as long as the fire it set lasts.
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.LOW)
  void onBurn(EntityDamageEvent event) {
    if (!event.getDamageSource().getDamageType().equals(DamageType.ON_FIRE)
        || !(event.getEntity() instanceof Player victim)
        || !runner.fighting(victim.getUniqueId())) {
      return;
    }
    var napalm = streaks().napalm();
    var owner = napalm.burning(victim);
    if (owner.isEmpty()) {
      return;
    }
    event.setCancelled(true);
    napalm.scorch(victim, event.getDamage(), owner.orElseThrow());
  }

  /**
   * Nothing that dies on a live map drops anything, as Red Warfare's golem killstreak cleared every
   * death's drops; a summon leaves no experience either.
   */
  @EventHandler(priority = EventPriority.HIGH)
  void onDeath(EntityDeathEvent event) {
    var entity = event.getEntity();
    if (runner.live() && entity.getWorld().equals(context.mapWorld())) {
      event.getDrops().clear();
    }
    if (streaks().summons().of(entity).isPresent()) {
      event.getDrops().clear();
      event.setDroppedExp(0);
    }
  }
}
