package com.shepherdjerred.thestorm.skytravel.adapter.paper;

import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.qol.app.CombatStatus;
import com.shepherdjerred.thestorm.skytravel.app.FlightChecks;
import com.shepherdjerred.thestorm.skytravel.app.FlightStore;
import com.shepherdjerred.thestorm.skytravel.domain.FlightLease;
import com.shepherdjerred.thestorm.skytravel.domain.LaunchConfig;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityToggleGlideEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerKickEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.util.Vector;
import org.jspecify.annotations.Nullable;

/**
 * Deliberate personal launches; recovery and final-descent cleanup never consult the launch flag.
 */
public final class LaunchFlights implements Listener {
  private static final String FLAG_KEY = "the-storm-skylands-launch-enabled";

  private record Pending(LaunchConfig.Tower tower, Instant readyAt, boolean approved, long token) {}

  private final ModuleContext context;
  private final LaunchConfig config;
  private final FlightStore store;
  private final CombatStatus combat;
  private final ManagedGameplay flags;
  private final FlightChecks checks;
  private final Map<UUID, FlightLease> flights = new HashMap<>();
  private final Map<UUID, Pending> pending = new HashMap<>();
  private final Map<UUID, Pending> committing = new HashMap<>();
  private @Nullable Cancellable task;
  private boolean ready;
  private boolean stopped;
  private long serial;

  public LaunchFlights(
      ModuleContext context, LaunchConfig config, FlightStore store, FlightChecks checks) {
    this.context = context;
    this.config = config;
    this.store = store;
    this.checks = checks;
    combat = context.services().require(CombatStatus.class);
    flags = context.services().require(ManagedGameplay.class);
  }

  public void start() {
    context.plugin().getServer().getPluginManager().registerEvents(this, context.plugin());
    var _ =
        store
            .load()
            .whenCompleteAsync(
                (rows, failure) -> {
                  if (stopped) return;
                  if (failure != null) {
                    context
                        .logger()
                        .error("Skylands flight recovery failed; launches remain closed", failure);
                    return;
                  }
                  for (var lease : rows) {
                    // A restart cannot repeat the initial launch. Continue the remaining
                    // glide/descent
                    // only.
                    flights.put(
                        lease.player(),
                        lease.phase() == FlightLease.Phase.ASCENT
                            ? lease.phase(FlightLease.Phase.GLIDE)
                            : lease);
                  }
                  ready = true;
                },
                context.scheduler().mainThread());
    task = context.scheduler().repeatOnMainThread(Duration.ZERO, Duration.ofMillis(50), this::tick);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void button(PlayerInteractEvent event) {
    if (event.getHand() != EquipmentSlot.HAND || event.getAction() != Action.RIGHT_CLICK_BLOCK)
      return;
    var block = event.getClickedBlock();
    if (block == null
        || block.getType() != Material.STONE_BUTTON
        || !block.getWorld().getName().equals(config.world())) return;
    var button = new LaunchConfig.Block(block.getX(), block.getY(), block.getZ());
    var tower =
        config.towers().stream()
            .filter(t -> t.commissioned() && t.button().equals(button))
            .findFirst();
    if (tower.isEmpty()) return;
    event.setCancelled(true);
    var player = event.getPlayer();
    var id = player.getUniqueId();
    if (!ready
        || pending.containsKey(id)
        || committing.containsKey(id)
        || !canLaunch(player, tower.orElseThrow())) {
      player.sendActionBar(
          Component.text("Stand on the launch pad, out of combat, to use this beacon."));
      return;
    }
    var request = new Pending(tower.orElseThrow(), context.time().instant(), false, ++serial);
    pending.put(id, request);
    var _ =
        flags
            .enabledOrDefault(
                FLAG_KEY,
                id,
                false,
                failure ->
                    context.logger().warn("Launch flag unavailable; new launches closed", failure))
            .whenCompleteAsync(
                (allowed, failure) -> evaluated(player, request, allowed, failure),
                context.scheduler().mainThread());
  }

  private void evaluated(
      Player player, Pending request, @Nullable Boolean allowed, @Nullable Throwable failure) {
    var id = player.getUniqueId();
    if (stopped || !request.equals(pending.get(id))) return;
    if (failure != null) context.logger().error("Invalid launch flag evaluation", failure);
    if (failure != null || !Boolean.TRUE.equals(allowed) || !canLaunch(player, request.tower())) {
      pending.remove(id);
      player.sendActionBar(Component.text("This beacon is unavailable."));
      return;
    }
    pending.put(
        id,
        new Pending(
            request.tower(),
            context.time().instant().plusSeconds(config.countdownSeconds()),
            true,
            ++serial));
    player.sendActionBar(
        Component.text(
            "Launching in "
                + config.countdownSeconds()
                + " seconds — step off the pad to cancel."));
  }

  private boolean canLaunch(Player player, LaunchConfig.Tower tower) {
    var lease = flights.get(player.getUniqueId());
    var now = context.time().instant();
    return player.isOnline()
        && !player.isDead()
        && player.getGameMode() == GameMode.SURVIVAL
        && !player.isInsideVehicle()
        && player.getPassengers().isEmpty()
        && !combat.inCombat(player.getUniqueId())
        && onPad(player, tower)
        && (lease == null
            || (lease.phase() == FlightLease.Phase.ENDED && !now.isBefore(lease.cooldownUntil())));
  }

  private boolean onPad(Player player, LaunchConfig.Tower tower) {
    var at = player.getLocation();
    return at.getWorld().getName().equals(config.world()) && tower.onPad(at.x(), at.y(), at.z());
  }

  private void tick() {
    if (!ready || stopped) return;
    var now = context.time().instant();
    for (var entry : Map.copyOf(pending).entrySet()) {
      var player = context.plugin().getServer().getPlayer(entry.getKey());
      var request = entry.getValue();
      if (player == null || !canLaunch(player, request.tower())) {
        pending.remove(entry.getKey());
      } else if (request.approved() && !now.isBefore(request.readyAt())) {
        begin(player, request, now);
      }
    }
    for (var player : context.plugin().getServer().getOnlinePlayers()) {
      var lease = flights.get(player.getUniqueId());
      if (lease == null || lease.phase() == FlightLease.Phase.ENDED) continue;
      update(player, lease, now);
    }
  }

  private void begin(Player player, Pending request, Instant now) {
    // Replacing the pending token prevents duplicate writes while SQLite commits the lease.
    var writing = new Pending(request.tower(), request.readyAt(), false, ++serial);
    pending.put(player.getUniqueId(), writing);
    committing.put(player.getUniqueId(), writing);
    var until = now.plusSeconds(config.assistanceSeconds());
    var lease =
        new FlightLease(
            player.getUniqueId(),
            FlightLease.Phase.ASCENT,
            until,
            until.plusSeconds(config.descentSeconds()),
            now.plusSeconds(config.cooldownSeconds()));
    var _ =
        store
            .save(lease)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  // A reset invalidates this completion before queuing its deletion. A cancelled
                  // request otherwise holds the write slot until cleanup, so no newer launch can
                  // be overwritten by its ENDED transition.
                  if (!writing.equals(committing.get(player.getUniqueId()))) return;
                  committing.remove(player.getUniqueId());
                  if (failure != null) {
                    context.logger().error("Skylands launch was not committed", failure);
                    if (writing.equals(pending.get(player.getUniqueId())))
                      pending.remove(player.getUniqueId());
                    return;
                  }
                  if (stopped
                      || !writing.equals(pending.get(player.getUniqueId()))
                      || !canLaunch(player, writing.tower())) {
                    persist(lease.phase(FlightLease.Phase.ENDED));
                    return;
                  }
                  pending.remove(player.getUniqueId());
                  flights.put(player.getUniqueId(), lease);
                  if (!assistChecks(player)) return;
                  player.setFallDistance(0);
                  player.setVelocity(new Vector(0, 3.5, 0));
                  player.sendMessage(
                      Component.text(
                          "Ride the updraft, then look where you want to glide. "
                              + "Landing ends the flight; the void is still dangerous."));
                },
                context.scheduler().mainThread());
  }

  private void update(Player player, FlightLease lease, Instant now) {
    var started = lease.assistedUntil().minusSeconds(config.assistanceSeconds());
    if (player.isDead()
        || player.getGameMode() != GameMode.SURVIVAL
        || !player.getWorld().getName().equals(config.world())
        || player.isInsideVehicle()
        || !player.getPassengers().isEmpty()
        || !lease.protectedFromFall(now)
        || (touchdown(player) && now.isAfter(started.plusSeconds(1)))) {
      end(player);
      return;
    }
    if (!lease.assisted(now)) {
      checks.active(player.getUniqueId(), false);
      if (lease.phase() != FlightLease.Phase.DESCENT) {
        persist(lease.phase(FlightLease.Phase.DESCENT));
        player.setGliding(false);
        player.sendActionBar(Component.text("Updraft fading — land within 30 seconds."));
      }
      return;
    }
    if (!assistChecks(player)) return;
    if (lease.phase() == FlightLease.Phase.ASCENT) {
      if (player.getY() < config.apex()) {
        // Clear 3×3 launch columns are checked during commissioning. Abort on an obstruction.
        var above = player.getLocation().add(0, 3, 0).getBlock();
        if (!above.getType().isAir()) {
          end(player);
          return;
        }
        player.setVelocity(new Vector(0, Math.min(3.5, config.apex() - player.getY() + 0.1), 0));
        return;
      }
      lease = lease.phase(FlightLease.Phase.GLIDE);
      persist(lease);
    }
    player.setGliding(true);
    var direction = player.getLocation().getDirection();
    var horizontal = new Vector(direction.getX(), 0, direction.getZ()).multiply(1.15);
    // Steering follows the player's view; gentle lift allows the longest neighbour hop.
    player.setVelocity(horizontal.setY(Math.max(-1.2, Math.min(-0.12, direction.getY() * 1.5))));
  }

  private void persist(FlightLease lease) {
    flights.put(lease.player(), lease);
    var _ =
        store
            .save(lease)
            .whenComplete(
                (ignored, failure) -> {
                  if (failure != null)
                    context.logger().error("Skylands flight transition did not persist", failure);
                });
  }

  private boolean assistChecks(Player player) {
    try {
      checks.active(player.getUniqueId(), true);
      return true;
    } catch (RuntimeException failure) {
      context.logger().error("Skylands movement integration refused the flight", failure);
      end(player);
      return false;
    }
  }

  private static boolean touchdown(Player player) {
    return ((org.bukkit.entity.Entity) player).isOnGround()
        || player.isInWater()
        || player.isInLava()
        || player.isClimbing();
  }

  private void end(Player player) {
    pending.remove(player.getUniqueId());
    var lease = flights.get(player.getUniqueId());
    if (lease == null || lease.phase() == FlightLease.Phase.ENDED) return;
    persist(lease.phase(FlightLease.Phase.ENDED));
    checks.active(player.getUniqueId(), false);
    player.setGliding(false);
    player.setFallDistance(0);
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  public void glide(EntityToggleGlideEvent event) {
    if (event.isGliding() || !(event.getEntity() instanceof Player player)) return;
    var lease = flights.get(player.getUniqueId());
    if (lease != null
        && lease.phase() == FlightLease.Phase.GLIDE
        && lease.assisted(context.time().instant())
        && !((org.bukkit.entity.Entity) player).isOnGround()
        && !player.isDead()
        && player.getWorld().getName().equals(config.world())) event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  public void vanillaFlight(PlayerKickEvent event) {
    var player = event.getPlayer();
    var lease = flights.get(player.getUniqueId());
    // Vanilla counts the deliberate ascent as floating. Exempt only this movement kick,
    // during the durable assistance lease; leave allow-flight and player abilities untouched.
    if (event.getCause() == PlayerKickEvent.Cause.FLYING_PLAYER
        && lease != null
        && lease.assisted(context.time().instant())
        && player.getGameMode() == GameMode.SURVIVAL
        && !player.isDead()
        && player.getWorld().getName().equals(config.world())) event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  public void fall(EntityDamageEvent event) {
    if (!(event.getEntity() instanceof Player player)
        || event.getCause() != EntityDamageEvent.DamageCause.FALL) return;
    var lease = flights.get(player.getUniqueId());
    if (lease != null
        && player.getWorld().getName().equals(config.world())
        && lease.protectedFromFall(context.time().instant())) {
      event.setCancelled(true);
      end(player);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void damage(EntityDamageEvent event) {
    if (event.getEntity() instanceof Player player) pending.remove(player.getUniqueId());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void teleport(PlayerTeleportEvent event) {
    end(event.getPlayer());
  }

  @EventHandler
  public void world(PlayerChangedWorldEvent event) {
    end(event.getPlayer());
  }

  @EventHandler
  public void died(PlayerDeathEvent event) {
    end(event.getEntity());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void mode(PlayerGameModeChangeEvent event) {
    end(event.getPlayer());
  }

  @EventHandler
  public void quit(PlayerQuitEvent event) {
    var id = event.getPlayer().getUniqueId();
    pending.remove(id);
    checks.active(id, false);
    var lease = flights.get(id);
    if (lease != null && lease.phase() == FlightLease.Phase.ASCENT)
      persist(lease.phase(FlightLease.Phase.GLIDE));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void move(PlayerMoveEvent event) {
    var id = event.getPlayer().getUniqueId();
    var request = pending.get(id);
    var to = event.getTo();
    if (request != null
        && (!to.getWorld().getName().equals(config.world())
            || !request.tower().onPad(to.x(), to.y(), to.z()))) pending.remove(id);
  }

  public CompletableFuture<Void> reset(UUID player) {
    var online = context.plugin().getServer().getPlayer(player);
    if (online != null) end(online);
    pending.remove(player);
    committing.remove(player);
    flights.remove(player);
    return store.reset(player);
  }

  public void stop() {
    stopped = true;
    pending.clear();
    committing.clear();
    var repeating = task;
    if (repeating != null) repeating.cancel();
    HandlerList.unregisterAll(this);
    checks.stop();
    // Persisted deadlines remain valid for restart recovery. No equipment/creative flight was
    // changed.
  }
}
