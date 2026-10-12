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

/**
 * Picks the arena transitions worth announcing outside the game: a lobby someone opens, a boss wave
 * that pays rewards, and a run's end with how far each fighter got. Runs an admin or a failure
 * stopped are not announced. Main thread only, like the stream it reads.
 */
public final class ArenaHeadlines {

  /** Per arena, the furthest wave each fighter of the current run has been recorded at. */
  private final Map<String, Map<String, Integer>> reached = new HashMap<>();

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
      switch (effect) {
        case GameEffect.RecordBestWave record -> run.merge(record.name(), record.wave(), Math::max);
        case GameEffect.SpawnBoss spawn
            when after.phase() instanceof Phase.Fighting fighting
                && fighting.wave() >= setup.rewards().firstWave() ->
            headlines.add(
                new Headline.BossWave(
                    setup.arenaName(), fighting.wave(), spawn.boss().boss().name()));
        default -> {
          // Other effects are only seen in game.
        }
      }
    }
    if (before.phase().running() && !after.phase().running()) {
      var fighters = Map.copyOf(run);
      run.clear();
      if (!(notification.event() instanceof GameEvent.Stop) && !fighters.isEmpty()) {
        headlines.add(
            new Headline.RunEnded(
                setup.arenaId(), setup.arenaName(), setup.tier().name(), fighters));
      }
    }
    return List.copyOf(headlines);
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
     * @param reached each fighter's name, to the furthest wave they reached
     */
    record RunEnded(String arenaId, String arena, String tier, Map<String, Integer> reached)
        implements Headline {

      public RunEnded {
        reached = Map.copyOf(reached);
      }

      public int furthest() {
        return reached.values().stream().mapToInt(Integer::intValue).max().orElseThrow();
      }
    }
  }
}
