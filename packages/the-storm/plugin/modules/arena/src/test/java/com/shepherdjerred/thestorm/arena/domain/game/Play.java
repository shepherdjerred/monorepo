package com.shepherdjerred.thestorm.arena.domain.game;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Drives an {@link ArenaGame} through events in tests, keeping the latest state. */
final class Play {

  ArenaGame game;
  Instant now;

  Play(Setup setup, Instant start) {
    this.game = ArenaGame.open(setup);
    this.now = start;
  }

  /** Applies {@code event}, which must be accepted, and returns its effects. */
  List<GameEffect> ok(GameEvent event) {
    return switch (game.on(event)) {
      case Result.Ok<ArenaGame.Step, GameError>(var step) -> {
        game = step.game();
        yield step.effects();
      }
      case Result.Err<ArenaGame.Step, GameError>(var error) ->
          throw new AssertionError(event + " was refused: " + error);
    };
  }

  /** Applies {@code event}, which must be refused, and returns why. The state is unchanged. */
  GameError refused(GameEvent event) {
    return switch (game.on(event)) {
      case Result.Ok<ArenaGame.Step, GameError>(var step) ->
          throw new AssertionError(event + " was accepted: " + step.effects());
      case Result.Err<ArenaGame.Step, GameError>(var error) -> error;
    };
  }

  /** A tick {@code seconds} later with {@code alive} arena mobs. */
  List<GameEffect> tick(long seconds, int alive) {
    now = now.plus(Duration.ofSeconds(seconds));
    return ok(new GameEvent.Tick(now, alive));
  }

  /** Joins, stores the snapshot, picks {@code kit} and readies. */
  void arrive(UUID player, String kit) {
    ok(new GameEvent.Join(player, name(player)));
    ok(new GameEvent.SnapshotStored(player));
    ok(new GameEvent.PickClass(player, kit, true));
    ok(new GameEvent.Ready(player));
  }

  /** Brings {@code players} in as knights and runs the countdown until the gates open. */
  List<GameEffect> start(UUID... players) {
    for (var player : players) {
      arrive(player, "knight");
    }
    tick(1, 0);
    return tick(game.setup().countdown().toSeconds(), 0);
  }

  Member member(UUID player) {
    return game.member(player).orElseThrow();
  }

  /** The test players' names: Alice, Bob, Carol and Dave. */
  static String name(UUID player) {
    return switch (player.toString().substring(35)) {
      case "a" -> "Alice";
      case "b" -> "Bob";
      case "c" -> "Carol";
      case "d" -> "Dave";
      default -> throw new IllegalArgumentException("not a test player: " + player);
    };
  }
}
