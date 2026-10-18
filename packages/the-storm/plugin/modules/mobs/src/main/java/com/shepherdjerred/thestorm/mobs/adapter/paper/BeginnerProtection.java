package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.essentials.app.ActivityFeed;
import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.mobs.app.BeginnerClock;
import com.shepherdjerred.thestorm.mobs.app.BeginnerStatus;
import com.shepherdjerred.thestorm.mobs.app.BeginnerTimeStore;
import com.shepherdjerred.thestorm.mobs.domain.config.BeginnerLuck;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** Async rollout and storage at session boundaries; combat reads an in-memory snapshot. */
final class BeginnerProtection implements BeginnerStatus {
  private final ModuleContext context;
  private final BeginnerLuck rules;
  private final ManagedGameplay rollout;
  private final AfkStatus afk;
  private final BeginnerClock clock;
  private final Runnable unsubscribe;
  private final Map<UUID, CompletableFuture<Boolean>> pending = new HashMap<>();
  private final Map<UUID, Instant> refreshAt = new HashMap<>();
  private final Set<UUID> evaluated = new HashSet<>();
  private final Map<UUID, Integer> phases = new ConcurrentHashMap<>();
  private final Map<UUID, Long> minutes = new ConcurrentHashMap<>();
  private final List<java.util.function.Consumer<UUID>> changes = new ArrayList<>();
  private boolean stopped;

  BeginnerProtection(ModuleContext context, BeginnerLuck rules, BeginnerTimeStore store) {
    this.context = context;
    this.rules = rules;
    rollout = context.services().require(ManagedGameplay.class);
    afk = context.services().require(AfkStatus.class);
    clock =
        new BeginnerClock(
            context.time(),
            store,
            failure -> context.logger().error("Could not persist beginner playtime", failure),
            this::advanced);
    unsubscribe =
        context
            .services()
            .require(ActivityFeed.class)
            .observe(
                (id, active) -> {
                  clock.activity(id, active);
                  context
                      .scheduler()
                      .runOnMainThread(
                          () -> {
                            var player = context.plugin().getServer().getPlayer(id);
                            if (player != null && !stopped) warm(player);
                          });
                });
  }

  void start() {
    var _ =
        clock
            .ready()
            .thenRunAsync(
                () -> {
                  if (!stopped) context.plugin().getServer().getOnlinePlayers().forEach(this::warm);
                },
                context.scheduler().mainThread());
  }

  OptionalLong active(Player player) {
    if (stopped
        || !Humans.isHuman(player)
        || !clock.ready().isDone()
        || clock.ready().isCompletedExceptionally()) return OptionalLong.empty();
    warm(player);
    if (!clock.enabled(player.getUniqueId())) return OptionalLong.empty();
    return OptionalLong.of(clock.millis(player.getUniqueId()));
  }

  @Override
  public CompletableFuture<Status> status(UUID id) {
    return clock
        .ready()
        .thenComposeAsync(
            ignored -> {
              var player = context.plugin().getServer().getPlayer(id);
              if (player == null || !Humans.isHuman(player) || stopped)
                return CompletableFuture.completedFuture(snapshot(id, false));
              return refresh(player)
                  .thenApplyAsync(
                      enabled -> snapshot(id, enabled), context.scheduler().mainThread());
            },
            context.scheduler().mainThread());
  }

  @Override
  public Optional<Status> current(UUID id) {
    if (!clock.ready().isDone()
        || clock.ready().isCompletedExceptionally()
        || !evaluated.contains(id)) return Optional.empty();
    return Optional.of(snapshot(id, !stopped && clock.enabled(id)));
  }

  private Status snapshot(UUID id, boolean enabled) {
    var millis = clock.millis(id);
    return new Status(
        enabled,
        Duration.ofMillis(millis),
        rules.calmFor(),
        rules.normalAfter(),
        rules.damageMultiplier(millis));
  }

  private CompletableFuture<Boolean> refresh(Player player) {
    var id = player.getUniqueId();
    if (stopped || !Humans.isHuman(player)) return CompletableFuture.completedFuture(false);
    var inFlight = pending.get(id);
    if (inFlight != null) return inFlight;
    if (!clock.ready().isDone() || clock.ready().isCompletedExceptionally())
      return CompletableFuture.completedFuture(false);
    var next = refreshAt.get(id);
    if (next != null && context.time().instant().isBefore(next))
      return CompletableFuture.completedFuture(clock.enabled(id));
    refreshAt.put(id, context.time().instant().plusSeconds(30));
    var result = new CompletableFuture<Boolean>();
    pending.put(id, result);
    var _ =
        rollout
            .enabled(ManagedGameplay.BEGINNERS_LUCK, id)
            .whenCompleteAsync(
                (enabled, failure) -> evaluated(player, result, enabled, failure),
                context.scheduler().mainThread());
    return result;
  }

  private void evaluated(
      Player player,
      CompletableFuture<Boolean> result,
      @Nullable Boolean enabled,
      @Nullable Throwable failure) {
    var id = player.getUniqueId();
    var owns = pending.remove(id, result);
    var on =
        failure == null && Boolean.TRUE.equals(enabled) && owns && player.isOnline() && !stopped;
    if (failure != null) context.logger().warn("Could not evaluate beginner's luck", failure);
    if (!stopped && owns) {
      if (failure == null) evaluated.add(id);
      else evaluated.remove(id);
      var was = clock.enabled(id);
      clock.enabled(id, on, on && !afk.isAfk(id));
      if (was != on) changed(id);
    }
    result.complete(on);
  }

  private void warm(Player player) {
    var _ = refresh(player);
  }

  void observeChanges(java.util.function.Consumer<UUID> observer) {
    changes.add(observer);
  }

  private void changed(UUID id) {
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              if (!stopped) changes.forEach(observer -> observer.accept(id));
            });
  }

  void left(Player player) {
    clock.activity(player.getUniqueId(), false);
    if (clock.ready().isDone() && !clock.ready().isCompletedExceptionally())
      clock.enabled(player.getUniqueId(), false, false);
    refreshAt.remove(player.getUniqueId());
    evaluated.remove(player.getUniqueId());
    pending.remove(player.getUniqueId());
    phases.remove(player.getUniqueId());
  }

  void stop() {
    stopped = true;
    unsubscribe.run();
    clock.close();
  }

  private void advanced(UUID id, long millis) {
    var phase =
        millis >= rules.normalAfter().toMillis() ? 2 : millis >= rules.calmFor().toMillis() ? 1 : 0;
    var previous = phases.put(id, phase);
    var minute = minutes.put(id, millis / 60_000);
    if (minute == null || minute != millis / 60_000) changed(id);
    if (previous == null || previous >= phase) return;
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              var player = context.plugin().getServer().getPlayer(id);
              if (player != null && !stopped)
                player.sendMessage(
                    phase == 1
                        ? "Beginner's luck: difficulty now rises gradually until "
                            + rules.normalAfter().toHours()
                            + " active hours. /beginnersluck shows your progress."
                        : "Your beginner's luck has ended. Wilderness combat is now at normal difficulty.");
            });
  }
}
