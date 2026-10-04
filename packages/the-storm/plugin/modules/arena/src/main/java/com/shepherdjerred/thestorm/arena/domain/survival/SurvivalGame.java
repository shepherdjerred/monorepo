package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.game.GameError;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Pure survival state machine. Server effects are carried out by its runner. */
public final class SurvivalGame {
  public enum Phase {
    LOBBY,
    COUNTDOWN,
    INTERMISSION,
    FIGHTING
  }

  private final Map<UUID, Survivor> players = new LinkedHashMap<>();
  private Phase phase = Phase.LOBBY;
  private Instant deadline = Instant.MIN;
  private int round;
  private int startRound = 1;
  private boolean debug;

  public boolean debug() {
    return debug;
  }

  public int startRound() {
    return startRound;
  }

  public boolean debugStart(int target) {
    if (target < 1 || target > 1000 || phase != Phase.LOBBY) return false;
    if (!players.isEmpty() && (!debug || startRound != target)) return false;
    debug = true;
    startRound = target;
    round = target - 1;
    return true;
  }

  public boolean purchaseSelfRevive(UUID id) {
    var player = players.get(id);
    if (player == null || player.status() != Survivor.Status.STANDING || player.selfRevive())
      return false;
    players.put(
        id,
        new Survivor(
            player.id(),
            player.name(),
            player.role(),
            player.status(),
            player.ready(),
            true,
            player.bleedout()));
    return true;
  }

  public Collection<Survivor> players() {
    return List.copyOf(players.values());
  }

  public Optional<Survivor> player(UUID id) {
    return Optional.ofNullable(players.get(id));
  }

  public Phase phase() {
    return phase;
  }

  public int round() {
    return round;
  }

  public boolean running() {
    return phase == Phase.FIGHTING || phase == Phase.INTERMISSION;
  }

  public Optional<GameError> join(UUID id, String name, boolean spectator) {
    if (players.containsKey(id)) {
      return Optional.of(GameError.ALREADY_JOINED);
    }
    if (!spectator && running()) {
      return Optional.of(GameError.IN_PROGRESS);
    }
    if (!spectator && participants().size() >= 4) {
      return Optional.of(GameError.FULL);
    }
    players.put(
        id,
        new Survivor(
            id,
            name,
            SurvivalClass.FIGHTER,
            Survivor.Status.JOINING,
            false,
            !spectator,
            Optional.empty()));
    return Optional.empty();
  }

  public void admitted(UUID id, boolean spectator) {
    players.computeIfPresent(
        id,
        (_, player) ->
            player.status(spectator ? Survivor.Status.SPECTATOR : Survivor.Status.LOBBY));
  }

  public Optional<GameError> select(UUID id, SurvivalClass role, long xp) {
    var player = players.get(id);
    if (player == null) {
      return Optional.of(GameError.NOT_A_MEMBER);
    }
    if (player.status() != Survivor.Status.LOBBY) {
      return Optional.of(GameError.NOT_IN_LOBBY);
    }
    if (!role.unlocked(xp)) {
      return Optional.of(GameError.CLASS_LOCKED);
    }
    players.put(id, player.select(role));
    phase = Phase.LOBBY;
    return Optional.empty();
  }

  public Optional<GameError> ready(UUID id, Instant now) {
    var player = players.get(id);
    if (player == null) {
      return Optional.of(GameError.NOT_A_MEMBER);
    }
    if (player.status() != Survivor.Status.LOBBY) {
      return Optional.of(GameError.NOT_IN_LOBBY);
    }
    players.put(id, player.markReady());
    if (participants().stream().allMatch(Survivor::ready)) {
      countdown(now);
    }
    return Optional.empty();
  }

  public boolean forceStart(Instant now) {
    if (running()
        || participants().isEmpty()
        || participants().stream().anyMatch(p -> p.status() != Survivor.Status.LOBBY)) {
      return false;
    }
    countdown(now.minusSeconds(10));
    return true;
  }

  private void countdown(Instant now) {
    phase = Phase.COUNTDOWN;
    deadline = now.plusSeconds(10);
  }

  /** Starts a round only when the adapter has prepared the map and its chunks. */
  public boolean advance(Instant now) {
    if ((phase != Phase.COUNTDOWN && phase != Phase.INTERMISSION) || now.isBefore(deadline)) {
      return false;
    }
    round++;
    phase = Phase.FIGHTING;
    players.replaceAll(
        (_, player) ->
            player.status() == Survivor.Status.LOBBY || player.status() == Survivor.Status.WAITING
                ? player.status(Survivor.Status.STANDING)
                : player);
    return true;
  }

  public void cleared(Instant now) {
    if (phase != Phase.FIGHTING) {
      throw new IllegalStateException("No round to clear");
    }
    phase = Phase.INTERMISSION;
    deadline = now.plusSeconds(8);
  }

  public boolean down(UUID id, Instant now) {
    var player = players.get(id);
    if (player == null || player.status() != Survivor.Status.STANDING) {
      return false;
    }
    if (participants().size() == 1 && player.selfRevive()) {
      players.put(id, player.revived(true));
      return true;
    }
    players.put(id, player.down(now));
    return false;
  }

  public void expire(Instant now) {
    players.replaceAll(
        (_, player) ->
            player.bleedout().filter(at -> !now.isBefore(at)).isPresent()
                ? player.status(Survivor.Status.WAITING)
                : player);
  }

  public boolean revive(UUID id) {
    var player = players.get(id);
    if (player == null || player.status() != Survivor.Status.DOWNED) {
      return false;
    }
    players.put(id, player.revived(false));
    return true;
  }

  public boolean wiped() {
    return running()
        && participants().stream().noneMatch(p -> p.status() == Survivor.Status.STANDING);
  }

  public List<Survivor> participants() {
    return players.values().stream()
        .filter(
            p ->
                p.status() != Survivor.Status.SPECTATOR
                    && !(p.status() == Survivor.Status.JOINING && !p.selfRevive()))
        .toList();
  }

  public void leave(UUID id) {
    players.remove(id);
    if (phase == Phase.COUNTDOWN) {
      phase = Phase.LOBBY;
    }
  }

  public void reset() {
    players.clear();
    phase = Phase.LOBBY;
    round = 0;
    startRound = 1;
    debug = false;
    deadline = Instant.MIN;
  }
}
