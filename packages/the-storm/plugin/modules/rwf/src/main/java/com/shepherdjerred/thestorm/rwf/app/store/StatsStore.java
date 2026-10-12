package com.shepherdjerred.thestorm.rwf.app.store;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Red Warfare's lifetime statistics, match history and each player's lasting choices. The totals
 * are written with each finished match (see {@code MatchStore.record}); this reads them and keeps
 * the preferences.
 */
public interface StatsStore {

  /** A statistic players are ranked by. */
  enum Stat {
    KILLS,
    ASSISTS,
    DEATHS,
    WINS,
    LOSSES,
    BEST_STREAK,
    BEST_WIN_STREAK,
    MATCHES,
    STEAKS,
  }

  /**
   * A player's lifetime totals.
   *
   * @param player who
   * @param name their name when they last played
   * @param matches matches played
   * @param kills kills
   * @param assists assists
   * @param deaths deaths
   * @param suicides suicides and quits
   * @param wins wins
   * @param losses losses
   * @param winStreak the current run of wins
   * @param bestWinStreak the longest run of wins
   * @param bestStreak the most whole killstreak steps in one match
   * @param time time spent in live matches
   * @param steaks steaks eaten
   */
  record Totals(
      UUID player,
      String name,
      int matches,
      int kills,
      int assists,
      int deaths,
      int suicides,
      int wins,
      int losses,
      int winStreak,
      int bestWinStreak,
      int bestStreak,
      Duration time,
      int steaks) {

    /** The value of {@code stat}. */
    public long value(Stat stat) {
      return switch (stat) {
        case KILLS -> kills;
        case ASSISTS -> assists;
        case DEATHS -> deaths;
        case WINS -> wins;
        case LOSSES -> losses;
        case BEST_STREAK -> bestStreak;
        case BEST_WIN_STREAK -> bestWinStreak;
        case MATCHES -> matches;
        case STEAKS -> steaks;
      };
    }
  }

  /**
   * One past match of a player's.
   *
   * @param matchId the match
   * @param mapId the map
   * @param endedAt when it ended
   * @param kit their kit
   * @param result {@code WIN}, {@code LOSE}, {@code LEFT} or {@code STOPPED}
   * @param kills their kills
   * @param assists their assists, if measured
   * @param deaths their deaths
   */
  record HistoryRow(
      UUID matchId,
      String mapId,
      Instant endedAt,
      String kit,
      String result,
      int kills,
      Optional<Integer> assists,
      int deaths) {}

  /**
   * A player's lasting choices.
   *
   * @param lastKit the kit they last played
   * @param teamChat whether their plain chat goes to their team during a match
   */
  record Prefs(Optional<String> lastKit, boolean teamChat) {

    /** Before a player has chosen anything: auto team chat is on, as in Red Warfare. */
    public static final Prefs DEFAULT = new Prefs(Optional.empty(), true);
  }

  CompletableFuture<Optional<Totals>> totals(UUID player);

  /** The top {@code limit} players by {@code stat}, best first. */
  CompletableFuture<List<Totals>> top(Stat stat, int limit);

  /** {@code player}'s last {@code limit} matches, newest first. */
  CompletableFuture<List<HistoryRow>> history(UUID player, int limit);

  CompletableFuture<Prefs> prefs(UUID player);

  CompletableFuture<Void> teamChat(UUID player, boolean on);
}
