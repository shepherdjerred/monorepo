package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import com.shepherdjerred.thestorm.arena.domain.game.Member;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/** Every arena's runner, and who is in which. Main thread only. */
public final class Arenas implements ArenaPresence {

  private final Map<String, GameRunner> runners;
  private final Snapshots snapshots;

  Arenas(List<GameRunner> runners, Snapshots snapshots) {
    var byId = new TreeMap<String, GameRunner>();
    runners.forEach(runner -> byId.put(runner.id(), runner));
    this.runners = byId;
    this.snapshots = snapshots;
  }

  @Override
  public Optional<String> arenaOf(UUID player) {
    return of(player).map(GameRunner::id);
  }

  Snapshots snapshots() {
    return snapshots;
  }

  Optional<GameRunner> byId(String id) {
    return Optional.ofNullable(runners.get(id));
  }

  /** The arena {@code player} is in. */
  Optional<GameRunner> of(UUID player) {
    return runners.values().stream()
        .filter(runner -> runner.member(player).isPresent())
        .findFirst();
  }

  @Override
  public boolean isGameRunningAt(Location location) {
    return runningAt(location).isPresent();
  }

  /** The arena whose region contains {@code location}. */
  Optional<GameRunner> at(Location location) {
    return runners.values().stream()
        .filter(runner -> runner.world().contains(location))
        .findFirst();
  }

  /** The arena whose region contains {@code location}, if a game is under way there. */
  Optional<GameRunner> runningAt(Location location) {
    return at(location).filter(runner -> runner.game().phase().running());
  }

  /** The arena {@code player} is in, once their snapshot is stored (not while still joining). */
  Optional<GameRunner> arrived(UUID player) {
    return of(player).filter(runner -> !isPending(runner, player));
  }

  /** Whether {@code player} is still joining an arena: frozen until their snapshot is stored. */
  boolean joining(UUID player) {
    return of(player).filter(runner -> isPending(runner, player)).isPresent();
  }

  private static boolean isPending(GameRunner runner, UUID player) {
    return runner.member(player).filter(Member.Pending.class::isInstance).isPresent();
  }

  Collection<GameRunner> all() {
    return List.copyOf(runners.values());
  }

  Collection<String> ids() {
    return List.copyOf(runners.keySet());
  }

  void tick() {
    runners.values().forEach(GameRunner::tick);
  }

  /** Stops every game and restores everyone: the plugin is shutting down. */
  void stopAll() {
    runners.values().forEach(runner -> runner.handle(new GameEvent.Stop()));
  }

  /** {@code player} asks to play in {@code runner}'s arena. */
  void join(Player player, GameRunner runner) {
    if (admit(player)) {
      runner
          .handle(new GameEvent.Join(player.getUniqueId(), player.getName()))
          .ifPresent(error -> Texts.error(player, error));
    }
  }

  /** {@code player} asks to watch {@code runner}'s arena. */
  void spectate(Player player, GameRunner runner) {
    if (admit(player)) {
      runner
          .handle(new GameEvent.Spectate(player.getUniqueId(), player.getName()))
          .ifPresent(error -> Texts.error(player, error));
    }
  }

  /** Whether {@code player} may join or watch an arena now. */
  private boolean admit(Player player) {
    var current = arenaOf(player.getUniqueId());
    if (current.isPresent()) {
      Texts.error(
          player, "You are already in " + current.orElseThrow() + ". Use /arena leave first.");
      return false;
    }
    var refusal = snapshots.refusal(player.getUniqueId());
    if (refusal.isEmpty()) {
      return true;
    }
    switch (refusal.orElseThrow()) {
      case NOT_LOADED ->
          Texts.error(player, "The arena is still starting up; try again in a moment.");
      case CLEANUP_PENDING ->
          Texts.error(
              player, "Your belongings from your last game are still being put away; try again.");
      case RESTORE_PENDING -> {
        snapshots.recover(player);
        Texts.error(player, "Your belongings from your last game were restored first; join again.");
      }
    }
    return false;
  }
}
