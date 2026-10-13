package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH_PLAYER;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_PLAYER_PREFS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_PLAYER_STATS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.rwf.adapter.db.generated.tables.records.RwfPlayerStatsRecord;
import com.shepherdjerred.thestorm.rwf.app.store.StatsStore;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.Field;

/**
 * {@link StatsStore} over {@code rwf_player_stats}, {@code rwf_match_player} and {@code
 * rwf_player_prefs}.
 */
public final class JooqStatsStore implements StatsStore {

  private final StormDatabase database;

  public JooqStatsStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Optional<Totals>> totals(UUID player) {
    return database.read(
        dsl ->
            dsl.selectFrom(RWF_PLAYER_STATS)
                .where(RWF_PLAYER_STATS.PLAYER.eq(player.toString()))
                .fetchOptional()
                .map(JooqStatsStore::totals));
  }

  @Override
  public CompletableFuture<List<Totals>> top(Stat stat, int limit) {
    if (limit < 1) {
      throw new IllegalArgumentException("limit must be positive");
    }
    return database.read(
        dsl ->
            dsl
                .selectFrom(RWF_PLAYER_STATS)
                .orderBy(field(stat).desc(), RWF_PLAYER_STATS.NAME.asc())
                .limit(limit)
                .fetch()
                .stream()
                .map(JooqStatsStore::totals)
                .toList());
  }

  private static Field<Integer> field(Stat stat) {
    return switch (stat) {
      case KILLS -> RWF_PLAYER_STATS.KILLS;
      case ASSISTS -> RWF_PLAYER_STATS.ASSISTS;
      case DEATHS -> RWF_PLAYER_STATS.DEATHS;
      case WINS -> RWF_PLAYER_STATS.WINS;
      case LOSSES -> RWF_PLAYER_STATS.LOSSES;
      case BEST_STREAK -> RWF_PLAYER_STATS.BEST_STREAK;
      case BEST_WIN_STREAK -> RWF_PLAYER_STATS.BEST_WIN_STREAK;
      case MATCHES -> RWF_PLAYER_STATS.MATCHES;
      case STEAKS -> RWF_PLAYER_STATS.STEAKS;
    };
  }

  @Override
  public CompletableFuture<List<HistoryRow>> history(UUID player, int limit) {
    if (limit < 1) {
      throw new IllegalArgumentException("limit must be positive");
    }
    return database.read(
        dsl ->
            dsl.select(
                    RWF_MATCH.ID,
                    RWF_MATCH.MAP,
                    RWF_MATCH.ENDED_AT,
                    RWF_MATCH_PLAYER.KIT,
                    RWF_MATCH_PLAYER.RESULT,
                    RWF_MATCH_PLAYER.KILLS,
                    RWF_MATCH_PLAYER.ASSISTS,
                    RWF_MATCH_PLAYER.DEATHS)
                .from(RWF_MATCH_PLAYER)
                .join(RWF_MATCH)
                .on(RWF_MATCH.ID.eq(RWF_MATCH_PLAYER.MATCH_ID))
                .where(RWF_MATCH_PLAYER.PLAYER.eq(player.toString()))
                .orderBy(RWF_MATCH.ENDED_AT.desc())
                .limit(limit)
                .fetch(
                    row ->
                        new HistoryRow(
                            UUID.fromString(row.get(RWF_MATCH.ID)),
                            row.get(RWF_MATCH.MAP),
                            Instant.ofEpochMilli(row.get(RWF_MATCH.ENDED_AT)),
                            row.get(RWF_MATCH_PLAYER.KIT),
                            row.get(RWF_MATCH_PLAYER.RESULT),
                            row.get(RWF_MATCH_PLAYER.KILLS),
                            Optional.ofNullable(row.get(RWF_MATCH_PLAYER.ASSISTS)),
                            row.get(RWF_MATCH_PLAYER.DEATHS))));
  }

  @Override
  public CompletableFuture<Prefs> prefs(UUID player) {
    return database.read(
        dsl ->
            dsl.selectFrom(RWF_PLAYER_PREFS)
                .where(RWF_PLAYER_PREFS.PLAYER.eq(player.toString()))
                .fetchOptional()
                .map(row -> new Prefs(Optional.ofNullable(row.getLastKit()), row.getTeamChat()))
                .orElse(Prefs.DEFAULT));
  }

  @Override
  public CompletableFuture<Void> teamChat(UUID player, boolean on) {
    return Writes.done(
        database.write(
            dsl -> {
              var updated =
                  dsl.update(RWF_PLAYER_PREFS)
                      .set(RWF_PLAYER_PREFS.TEAM_CHAT, on)
                      .where(RWF_PLAYER_PREFS.PLAYER.eq(player.toString()))
                      .execute();
              if (updated == 0) {
                dsl.insertInto(RWF_PLAYER_PREFS)
                    .set(RWF_PLAYER_PREFS.PLAYER, player.toString())
                    .set(RWF_PLAYER_PREFS.TEAM_CHAT, on)
                    .set(RWF_PLAYER_PREFS.KIT_LAYOUTS, "{}")
                    .execute();
              }
              return true;
            }));
  }

  private static Totals totals(RwfPlayerStatsRecord row) {
    return new Totals(
        UUID.fromString(row.getPlayer()),
        row.getName(),
        row.getMatches(),
        row.getKills(),
        row.getAssists(),
        row.getDeaths(),
        row.getSuicides(),
        row.getWins(),
        row.getLosses(),
        row.getWinStreak(),
        row.getBestWinStreak(),
        row.getBestStreak(),
        Duration.ofMillis(row.getTimeMs()),
        row.getSteaks());
  }
}
