package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyLife;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyScene;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.jspecify.annotations.Nullable;

/**
 * The bots' lobby planning off the main thread, beside the match's {@link ThinkLoop}: the main
 * thread publishes a {@link Round} (the lobby and the bots in it) a couple of times a second into a
 * one-slot mailbox, one job at a time runs {@link LobbyLife} for every bot on the compute pool, and
 * the newest plans are read back with one volatile read. Randomness is a fresh {@link
 * SplittableRandom} per bot per round, seeded from the match, the bot and the tick, so a replay
 * plans the same.
 */
public final class LobbyLoop {

  private final ComputePool compute;
  private final AtomicReference<@Nullable Round> inbox = new AtomicReference<>();
  private final AtomicReference<Map<UUID, LobbyPlan>> outbox = new AtomicReference<>(Map.of());
  private final AtomicBoolean running = new AtomicBoolean();
  private final AtomicInteger generation = new AtomicInteger();
  private final Map<UUID, LobbyPlan> plans = new HashMap<>();
  private volatile @Nullable Lobby lobby;
  private int generationSeen = -1;

  public LobbyLoop(ComputePool compute) {
    this.compute = compute;
  }

  /**
   * One planning round.
   *
   * @param scene the lobby now
   * @param bots the bots to plan for
   */
  public record Round(LobbyScene scene, List<LobbyLife.Self> bots) {

    public Round {
      bots = List.copyOf(bots);
    }
  }

  /** The lobby the loop plans in. */
  private record Lobby(int generation, long seed, NavArtifact nav) {}

  /** Starts planning for a match's lobby; forgets every plan of the last one. */
  public void begin(long seed, NavArtifact nav) {
    outbox.set(Map.of());
    lobby = new Lobby(generation.incrementAndGet(), seed, nav);
  }

  /** Stops planning; rounds are ignored until the next lobby begins. */
  public void end() {
    lobby = null;
    inbox.set(null);
    outbox.set(Map.of());
  }

  public boolean planning() {
    return lobby != null;
  }

  /** Hands the newest round to the worker and makes sure a job is running. */
  public void publish(Round round) {
    if (lobby == null) {
      return;
    }
    inbox.set(round);
    schedule();
  }

  private void schedule() {
    if (!running.compareAndSet(false, true)) {
      return;
    }
    try {
      compute.executor().execute(this::run);
    } catch (RejectedExecutionException rejected) {
      running.set(false);
      throw rejected;
    }
  }

  /** The newest plans by bot, with one volatile read. */
  public Map<UUID, LobbyPlan> plans() {
    return outbox.get();
  }

  private void run() {
    try {
      Round round;
      while ((round = inbox.getAndSet(null)) != null) {
        var current = lobby;
        if (current != null) {
          plan(current, round);
        }
      }
    } finally {
      running.set(false);
    }
    if (inbox.get() != null && lobby != null) {
      schedule();
    }
  }

  private void plan(Lobby current, Round round) {
    if (generationSeen != current.generation()) {
      plans.clear();
      generationSeen = current.generation();
    }
    var tick = round.scene().tick();
    var next = new HashMap<UUID, LobbyPlan>();
    for (var self : round.bots()) {
      if (round.scene().person(self.uuid()).isEmpty()) {
        continue;
      }
      var random =
          new SplittableRandom(ThinkLoop.seed(current.seed(), self.uuid().hashCode(), tick));
      var plan =
          LobbyLife.next(
              new LobbyLife.Input(
                  self, round.scene(), current.nav(), Optional.ofNullable(plans.get(self.uuid()))),
              random);
      next.put(self.uuid(), plan);
    }
    plans.clear();
    plans.putAll(next);
    var live = lobby;
    if (live != null && live.generation() == current.generation()) {
      outbox.set(Map.copyOf(next));
    }
  }
}
