package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.event.player.PlayerItemConsumeEvent;

/**
 * Gathers what happened since the last tick that a bot might hear: hits, bow shots and eating from
 * the server's events, and fuse clicks from the match. The capture drains it once per tick and
 * turns the raw events into {@link Stimulus} values with the match's ids. Cancelled damage events
 * are kept: rwf cancels every member hit and applies its own damage, so the swing still landed.
 * Main thread only.
 */
public final class StimulusCollector implements Listener {

  /**
   * One raw event.
   *
   * @param kind what happened
   * @param at where
   * @param source who did it
   * @param victim who was hit, for hits
   */
  public record Raw(Stimulus.Kind kind, Location at, UUID source, Optional<UUID> victim) {}

  private final List<Raw> pending = new ArrayList<>();

  @EventHandler(priority = EventPriority.MONITOR)
  void onDamage(EntityDamageByEntityEvent event) {
    if (!(event.getEntity() instanceof Player victim)) {
      return;
    }
    responsible(event.getDamager())
        .ifPresent(
            attacker ->
                pending.add(
                    new Raw(
                        Stimulus.Kind.HIT,
                        Places.at(victim),
                        attacker.getUniqueId(),
                        Optional.of(victim.getUniqueId()))));
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void onShoot(EntityShootBowEvent event) {
    if (event.getEntity() instanceof Player shooter) {
      pending.add(
          new Raw(
              Stimulus.Kind.BOW_SHOT, Places.at(shooter), shooter.getUniqueId(), Optional.empty()));
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void onEat(PlayerItemConsumeEvent event) {
    var eater = event.getPlayer();
    pending.add(
        new Raw(Stimulus.Kind.EAT, Places.at(eater), eater.getUniqueId(), Optional.empty()));
  }

  /** A bot's arrow left through the actions port, which fires no bow event for it. */
  public void shot(Player shooter) {
    pending.add(
        new Raw(
            Stimulus.Kind.BOW_SHOT, Places.at(shooter), shooter.getUniqueId(), Optional.empty()));
  }

  /** The match accepted a fuse click on the bomb at {@code bomb} by {@code clicker}. */
  public void fuseClicked(UUID clicker, Location bomb) {
    pending.add(new Raw(Stimulus.Kind.FUSE_CLICK, bomb, clicker, Optional.empty()));
  }

  /** A sprinting combatant's footstep. */
  public void footstep(Player runner) {
    pending.add(
        new Raw(Stimulus.Kind.FOOTSTEP, Places.at(runner), runner.getUniqueId(), Optional.empty()));
  }

  /** Everything since the last drain. */
  public List<Raw> drain() {
    var drained = List.copyOf(pending);
    pending.clear();
    return drained;
  }

  private static Optional<Player> responsible(Entity damager) {
    return switch (damager) {
      case Player player -> Optional.of(player);
      case Projectile projectile when projectile.getShooter() instanceof Player shooter ->
          Optional.of(shooter);
      default -> Optional.empty();
    };
  }
}
