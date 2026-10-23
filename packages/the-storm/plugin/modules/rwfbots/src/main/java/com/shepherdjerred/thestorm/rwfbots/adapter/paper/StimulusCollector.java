package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.BattleSounds;
import com.shepherdjerred.thestorm.rwf.app.view.Point;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import java.time.InstantSource;
import java.util.ArrayDeque;
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

  private final ArrayDeque<Raw> pending = new ArrayDeque<>();
  private final BattleSounds sounds;
  private final InstantSource time;

  public StimulusCollector(BattleSounds sounds, InstantSource time) {
    this.sounds = sounds;
    this.time = time;
  }

  BattleSounds sounds() {
    return sounds;
  }

  InstantSource time() {
    return time;
  }

  private void add(Raw raw) {
    pending.add(raw);
    while (pending.size() > com.shepherdjerred.thestorm.rwf.app.BattleSoundLog.CAPACITY)
      pending.removeFirst();
    var at = raw.at();
    sounds.emit(
        new BattleSounds.Sound(
            java.util.Objects.requireNonNull(at.getWorld()).getUID(),
            raw.source(),
            new Point(at.getX(), at.getY(), at.getZ()),
            kind(raw.kind()),
            raw.kind().range(),
            raw.victim()));
  }

  private static BattleSounds.Kind kind(Stimulus.Kind kind) {
    return switch (kind) {
      case FOOTSTEP -> BattleSounds.Kind.STEP;
      case LAND -> BattleSounds.Kind.LAND;
      case SPLASH -> BattleSounds.Kind.SPLASH;
      case BOW_SHOT -> BattleSounds.Kind.BOW;
      case HIT -> BattleSounds.Kind.MELEE;
      case EAT -> BattleSounds.Kind.EAT;
      case FUSE_CLICK, FUSE_HISS -> BattleSounds.Kind.FUSE;
    };
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onDamage(EntityDamageByEntityEvent event) {
    if (!(event.getEntity() instanceof Player victim)) {
      return;
    }
    responsible(event.getDamager())
        .ifPresent(
            attacker ->
                add(
                    new Raw(
                        Stimulus.Kind.HIT,
                        Places.at(victim),
                        attacker.getUniqueId(),
                        Optional.of(victim.getUniqueId()))));
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void onShoot(EntityShootBowEvent event) {
    if (event.getEntity() instanceof Player shooter) {
      add(
          new Raw(
              Stimulus.Kind.BOW_SHOT, Places.at(shooter), shooter.getUniqueId(), Optional.empty()));
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void onEat(PlayerItemConsumeEvent event) {
    var eater = event.getPlayer();
    add(new Raw(Stimulus.Kind.EAT, Places.at(eater), eater.getUniqueId(), Optional.empty()));
  }

  /** A bot's arrow left through the actions port, which fires no bow event for it. */
  public void shot(Player shooter) {
    add(
        new Raw(
            Stimulus.Kind.BOW_SHOT, Places.at(shooter), shooter.getUniqueId(), Optional.empty()));
  }

  /** The match accepted a fuse click on the bomb at {@code bomb} by {@code clicker}. */
  public void fuseClicked(UUID clicker, Location bomb) {
    add(new Raw(Stimulus.Kind.FUSE_CLICK, bomb, clicker, Optional.empty()));
  }

  /** A sprinting combatant's footstep. */
  public void footstep(Player runner) {
    add(new Raw(Stimulus.Kind.FOOTSTEP, Places.at(runner), runner.getUniqueId(), Optional.empty()));
  }

  /** Everything since the last drain. */
  public List<Raw> drain() {
    var drained = List.copyOf(pending);
    pending.clear();
    return drained;
  }

  public void motion(Player player, Stimulus.Kind kind) {
    add(new Raw(kind, Places.at(player), player.getUniqueId(), Optional.empty()));
  }

  /**
   * The player whose own swing or arrow {@code damager} is. A summon's blow names nobody: rwf
   * credits it to the summon's owner, but the owner may be anywhere, and a bot hit by a golem must
   * not go after the player who called it.
   */
  private static Optional<Player> responsible(Entity damager) {
    return switch (damager) {
      case Player player -> Optional.of(player);
      case Projectile projectile when projectile.getShooter() instanceof Player shooter ->
          Optional.of(shooter);
      default -> Optional.empty();
    };
  }
}
