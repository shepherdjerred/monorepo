package com.shepherdjerred.thestorm.arena.app;

import com.shepherdjerred.thestorm.arena.domain.game.ArenaGame;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import com.shepherdjerred.thestorm.arena.domain.game.Member;
import com.shepherdjerred.thestorm.arena.domain.game.Phase;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Picks the arena transitions worth announcing outside the game: a lobby someone opens, a boss wave
 * that pays rewards, and a run's end with how far each fighter got. Runs an admin or a failure
 * stopped are not announced. Main thread only, like the stream it reads.
 */
public final class ArenaHeadlines {

  /** Per arena, the furthest wave each fighter of the current run has been recorded at. */
  private final Map<String, Map<UUID, Headline.Fighter>> reached = new HashMap<>();

  /** What {@code notification} is worth announcing, in order. */
  public List<Headline> accept(ArenaNotification notification) {
    var before = notification.before();
    var after = notification.after();
    var setup = after.setup();
    var run = reached.computeIfAbsent(setup.arenaId(), _ -> new LinkedHashMap<>());
    var headlines = new ArrayList<Headline>();
    if (lobby(before).isEmpty() && !after.phase().running()) {
      lobby(after)
          .ifPresent(
              member -> headlines.add(new Headline.LobbyOpened(setup.arenaName(), member.name())));
    }
    for (var effect : notification.effects()) {
      effect(effect, after, run).ifPresent(headlines::add);
    }
    if (before.phase().running() && !after.phase().running()) {
      var fighters = List.copyOf(run.values());
      run.clear();
      if (!(notification.event() instanceof GameEvent.Stop) && !fighters.isEmpty()) {
        headlines.add(
            new Headline.RunEnded(
                setup.arenaId(), setup.arenaName(), setup.tier().name(), fighters));
      }
    }
    return List.copyOf(headlines);
  }

  /** What {@code game} is doing, for a status line; empty when nobody is in it. */
  public static Optional<String> activity(ArenaGame game) {
    var name = game.setup().arenaName();
    return switch (game.phase()) {
      case Phase.Fighting fighting -> Optional.of(name + ": wave " + fighting.wave());
      case Phase.Intermission between ->
          Optional.of(name + ": wave " + Math.max(1, between.nextWave() - 1));
      case Phase.Lobby _, Phase.Countdown _ -> lobby(game).map(_ -> name + ": lobby open");
    };
  }

  /** Records a fighter's wave, or names a rewarding boss wave. */
  private static Optional<Headline> effect(
      GameEffect effect, ArenaGame after, Map<UUID, Headline.Fighter> run) {
    switch (effect) {
      case GameEffect.RecordBestWave record ->
          run.merge(
              record.player(),
              new Headline.Fighter(record.player(), record.name(), record.wave()),
              (old, recorded) -> recorded.wave() > old.wave() ? recorded : old);
      case GameEffect.SpawnBoss spawn
          when after.phase() instanceof Phase.Fighting fighting
              && fighting.wave() >= after.setup().rewards().firstWave() -> {
        return Optional.of(
            new Headline.BossWave(
                after.setup().arenaName(), fighting.wave(), spawn.boss().boss().name()));
      }
      default -> {
        // Other effects are only seen in game.
      }
    }
    return Optional.empty();
  }

  private static Optional<Member.InLobby> lobby(ArenaGame game) {
    return game.members().stream()
        .filter(Member.InLobby.class::isInstance)
        .map(Member.InLobby.class::cast)
        .findFirst();
  }

  /** Something worth announcing. */
  public sealed interface Headline {

    /**
     * Someone entered an empty arena lobby.
     *
     * @param arena the arena's name
     * @param player who
     */
    record LobbyOpened(String arena, String player) implements Headline {}

    /**
     * A boss wave that pays rewards began.
     *
     * @param arena the arena's name
     * @param wave the wave
     * @param boss the boss's name
     */
    record BossWave(String arena, int wave, String boss) implements Headline {}

    /**
     * A run ended with every fighter out.
     *
     * @param arenaId the arena
     * @param arena the arena's name
     * @param tier the arena's tier
     * @param fighters everyone who fought, in the order they were recorded
     */
    record RunEnded(String arenaId, String arena, String tier, List<Fighter> fighters)
        implements Headline {

      public RunEnded {
        fighters = List.copyOf(fighters);
      }

      public int furthest() {
        return fighters.stream().mapToInt(Fighter::wave).max().orElseThrow();
      }
    }

    /**
     * How far one fighter got.
     *
     * @param id the player
     * @param name their name
     * @param wave the furthest wave they reached
     */
    record Fighter(UUID id, String name, int wave) {}
  }
}
