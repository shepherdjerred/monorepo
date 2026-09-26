package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.qol.app.CombatTracker;
import com.shepherdjerred.thestorm.qol.domain.config.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerKickEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Combat tags: a hit between two players (in melee or with a projectile) tags both. A tagged player
 * sees a countdown above their hotbar, cannot teleport, and dies if they log out (their items go to
 * a grave), unless staff or the server removed them.
 */
final class CombatListener implements Listener {

  /** Removals that are not the player's choice, so they never cost a life. */
  private static final Set<PlayerKickEvent.Cause> NOT_THEIR_CHOICE =
      EnumSet.of(
          PlayerKickEvent.Cause.PLUGIN,
          PlayerKickEvent.Cause.KICKED,
          PlayerKickEvent.Cause.BANNED,
          PlayerKickEvent.Cause.IP_BANNED,
          PlayerKickEvent.Cause.WHITELIST,
          PlayerKickEvent.Cause.RESTART_COMMAND);

  private final QolRuntime runtime;
  private final CombatTracker tracker;
  private final QolConfig.Combat config;
  private final Set<UUID> removed = new HashSet<>();

  CombatListener(QolRuntime runtime, CombatTracker tracker, QolConfig.Combat config) {
    this.runtime = runtime;
    this.tracker = tracker;
    this.config = config;
  }

  /** Only hits that land: protection (PvP off here, or for either player) cancels earlier. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onHit(EntityDamageByEntityEvent event) {
    if (!(event.getEntity() instanceof Player victim)) {
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

  private static Optional<Player> attacker(Entity damager) {
    if (damager instanceof Player player) {
      return Optional.of(player);
    }
    if (damager instanceof Projectile projectile && projectile.getShooter() instanceof Player p) {
      return Optional.of(p);
    }
    return Optional.empty();
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onDeath(PlayerDeathEvent event) {
    tracker.clear(event.getEntity().getUniqueId());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onKick(PlayerKickEvent event) {
    if (NOT_THEIR_CHOICE.contains(event.getCause())) {
      removed.add(event.getPlayer().getUniqueId());
    }
  }

  /** First, so the death (and its grave) happens before anything else handles the logout. */
  @EventHandler(priority = EventPriority.LOWEST)
  void onQuit(PlayerQuitEvent event) {
    var player = event.getPlayer();
    var id = player.getUniqueId();
    var removedByServer = removed.remove(id);
    var tagged = tracker.inCombat(id);
    tracker.clear(id);
    if (!tagged || removedByServer || !config.killOnLogout() || player.isDead()) {
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
