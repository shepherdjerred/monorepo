package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.qol.app.CombatTracker;
import com.shepherdjerred.thestorm.qol.domain.config.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.AreaEffectCloud;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.entity.Tameable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Combat tags: a damaging hit between two players tags both. The attacker may be the player, their
 * projectile, their tamed pet, TNT they lit or a lingering potion they threw. A tagged player sees
 * a countdown above their hotbar, cannot teleport, and dies if they disconnect or time out (their
 * items go to a grave); kicks, bans and server errors never kill.
 */
final class CombatListener implements Listener {

  /** Quits that are the player's own doing. */
  private static final Set<PlayerQuitEvent.QuitReason> CHOSEN_QUITS =
      EnumSet.of(PlayerQuitEvent.QuitReason.DISCONNECTED, PlayerQuitEvent.QuitReason.TIMED_OUT);

  private final QolRuntime runtime;
  private final CombatTracker tracker;
  private final QolConfig.Combat config;

  CombatListener(QolRuntime runtime, CombatTracker tracker, QolConfig.Combat config) {
    this.runtime = runtime;
    this.tracker = tracker;
    this.config = config;
  }

  /** Only hits that land and hurt: protection (PvP off for either player) cancels earlier. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onHit(EntityDamageByEntityEvent event) {
    if (!(event.getEntity() instanceof Player victim) || !(event.getFinalDamage() > 0)) {
      return;
    }
    var attacker = attacker(event.getDamager());
    if (attacker.isEmpty()) {
      return;
    }
    for (var fresh : tracker.hit(attacker.orElseThrow().getUniqueId(), victim.getUniqueId())) {
      var player = runtime.server().getPlayer(fresh);
      if (player != null) {
        Say.error(
            player,
            Say.COMBAT,
            "You are in combat. Teleports are blocked"
                + (config.killOnLogout() ? ", and logging out now kills you." : "."));
      }
    }
  }

  /** The player behind whatever did the damage, where the game records one. */
  static Optional<Player> attacker(Entity damager) {
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

  @EventHandler(priority = EventPriority.MONITOR)
  void onDeath(PlayerDeathEvent event) {
    tracker.clear(event.getEntity().getUniqueId());
  }

  /** First, so the death (and its grave) happens before anything else handles the logout. */
  @EventHandler(priority = EventPriority.LOWEST)
  void onQuit(PlayerQuitEvent event) {
    var player = event.getPlayer();
    var id = player.getUniqueId();
    var tagged = tracker.inCombat(id);
    tracker.clear(id);
    if (!tagged
        || !config.killOnLogout()
        || !CHOSEN_QUITS.contains(event.getReason())
        || player.isDead()) {
      return;
    }
    player.setHealth(0);
    runtime
        .server()
        .broadcast(
            HouseStyle.error(
                Say.COMBAT,
                Component.text(config.logoutMessage().replace("{player}", player.getName()))));
  }

  /** Every second: the countdown for tagged players, and a note when a tag ends. */
  void tick() {
    for (var ended : tracker.sweep()) {
      var player = runtime.server().getPlayer(ended);
      if (player != null) {
        player.sendActionBar(Component.text("You are no longer in combat.", NamedTextColor.GREEN));
      }
    }
    for (var tagged : tracker.tagged()) {
      var player = runtime.server().getPlayer(tagged);
      var remaining = tracker.remaining(tagged);
      if (player != null && remaining.isPresent()) {
        player.sendActionBar(
            Component.text(
                "In combat: " + DurationText.of(remaining.orElseThrow()), NamedTextColor.RED));
      }
    }
  }
}
