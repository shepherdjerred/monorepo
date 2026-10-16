package com.shepherdjerred.thestorm.essentials.app;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.essentials.domain.afk.AfkState;
import java.time.Duration;
import java.time.InstantSource;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiConsumer;

/**
 * Online players' away status. Activity may be reported from any thread (chat is async); the
 * periodic sweep runs on the main thread.
 */
public final class AfkTracker implements AfkStatus, ActivityFeed {

  private final InstantSource time;
  private final Duration timeout;
  private final ProductAnalytics analytics;
  private final Map<UUID, AfkState> states = new ConcurrentHashMap<>();
  private final List<BiConsumer<UUID, Boolean>> observers = new CopyOnWriteArrayList<>();

  @Override
  public Runnable observe(BiConsumer<UUID, Boolean> observer) {
    observers.add(observer);
    return () -> observers.remove(observer);
  }

  private void checkpoint(UUID player, boolean active) {
    observers.forEach(observer -> observer.accept(player, active));
  }

  public AfkTracker(InstantSource time, Duration timeout, ProductAnalytics analytics) {
    this.time = time;
    this.timeout = timeout;
    this.analytics = analytics;
  }

  /** A player joined: active and not away. */
  public void joined(UUID player) {
    states.compute(
        player,
        (id, previous) -> {
          checkpoint(id, true);
          return AfkState.joined(time.instant());
        });
  }

  /** A player left. */
  public void left(UUID player) {
    states.computeIfPresent(
        player,
        (id, previous) -> {
          checkpoint(id, false);
          return null;
        });
  }

  /** The player did something. Returns true if this brought them back from being away. */
  public boolean active(UUID player) {
    var wasAway = new AtomicBoolean();
    states.computeIfPresent(
        player,
        (id, state) -> {
          wasAway.set(state.afk());
          if (state.afk()) analytics.afk(player, false);
          checkpoint(id, true);
          return state.active(time.instant());
        });
    return wasAway.get();
  }

  /** {@code /afk}: returns whether the player is now away. */
  public boolean toggle(UUID player) {
    var now = time.instant();
    var next =
        states.compute(
            player,
            (id, state) -> {
              var toggled = (state == null ? AfkState.joined(now) : state).toggle(now);
              analytics.afk(id, toggled.afk());
              checkpoint(id, !toggled.afk());
              return toggled;
            });
    return next.afk();
  }

  /** Marks idle players away; returns the players who just became away. */
  public List<UUID> sweep() {
    var now = time.instant();
    var newlyAway = new ConcurrentLinkedQueue<UUID>();
    states.replaceAll(
        (id, state) -> {
          var next = state.idleCheck(timeout, now);
          if (next.afk() && !state.afk()) {
            analytics.afk(id, true);
            newlyAway.add(id);
          }
          checkpoint(id, !next.afk());
          return next;
        });
    return List.copyOf(newlyAway);
  }

  @Override
  public boolean isAfk(UUID player) {
    var state = states.get(player);
    return state != null && state.afk();
  }
}
