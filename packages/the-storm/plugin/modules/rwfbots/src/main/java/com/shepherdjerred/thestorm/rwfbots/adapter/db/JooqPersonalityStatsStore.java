package com.shepherdjerred.thestorm.rwfbots.adapter.db;

import static com.shepherdjerred.thestorm.rwfbots.adapter.db.generated.Tables.RWFBOTS_PERSONALITY_STATS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.rwfbots.app.PersonalityStats;
import com.shepherdjerred.thestorm.rwfbots.app.PersonalityStatsStore;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.jooq.Record;

/** {@link PersonalityStatsStore} over {@code rwfbots_personality_stats}. */
public final class JooqPersonalityStatsStore implements PersonalityStatsStore {

  private final StormDatabase database;

  public JooqPersonalityStatsStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<PersonalityStats>> loadAll() {
    return database.read(
        dsl ->
            dsl.selectFrom(RWFBOTS_PERSONALITY_STATS)
                .orderBy(RWFBOTS_PERSONALITY_STATS.PERSONALITY_ID)
                .fetch(JooqPersonalityStatsStore::stats));
  }

  @Override
  public CompletableFuture<Void> save(Collection<PersonalityStats> stats) {
    var rows = List.copyOf(stats);
    return database
        .write(
            dsl -> {
              for (var row : rows) {
                dsl.insertInto(RWFBOTS_PERSONALITY_STATS)
                    .set(RWFBOTS_PERSONALITY_STATS.PERSONALITY_ID, row.personalityId())
                    .set(RWFBOTS_PERSONALITY_STATS.MATCHES, row.matches())
                    .set(RWFBOTS_PERSONALITY_STATS.WINS, row.wins())
                    .set(RWFBOTS_PERSONALITY_STATS.KILLS, row.kills())
                    .set(RWFBOTS_PERSONALITY_STATS.DEATHS, row.deaths())
                    .set(RWFBOTS_PERSONALITY_STATS.PLANTS, row.plants())
                    .set(RWFBOTS_PERSONALITY_STATS.DEFUSES, row.defuses())
                    .set(RWFBOTS_PERSONALITY_STATS.MU, row.rating().mu())
                    .set(RWFBOTS_PERSONALITY_STATS.SIGMA, row.rating().sigma())
                    .set(RWFBOTS_PERSONALITY_STATS.LAST_SEEN, row.lastSeen().toEpochMilli())
                    .onConflict(RWFBOTS_PERSONALITY_STATS.PERSONALITY_ID)
                    .doUpdate()
                    .set(RWFBOTS_PERSONALITY_STATS.MATCHES, row.matches())
                    .set(RWFBOTS_PERSONALITY_STATS.WINS, row.wins())
                    .set(RWFBOTS_PERSONALITY_STATS.KILLS, row.kills())
                    .set(RWFBOTS_PERSONALITY_STATS.DEATHS, row.deaths())
                    .set(RWFBOTS_PERSONALITY_STATS.PLANTS, row.plants())
                    .set(RWFBOTS_PERSONALITY_STATS.DEFUSES, row.defuses())
                    .set(RWFBOTS_PERSONALITY_STATS.MU, row.rating().mu())
                    .set(RWFBOTS_PERSONALITY_STATS.SIGMA, row.rating().sigma())
                    .set(RWFBOTS_PERSONALITY_STATS.LAST_SEEN, row.lastSeen().toEpochMilli())
                    .execute();
              }
              return rows.size();
            })
        .thenAccept(count -> {});
  }

  private static PersonalityStats stats(Record row) {
    return new PersonalityStats(
        row.get(RWFBOTS_PERSONALITY_STATS.PERSONALITY_ID),
        row.get(RWFBOTS_PERSONALITY_STATS.MATCHES),
        row.get(RWFBOTS_PERSONALITY_STATS.WINS),
        row.get(RWFBOTS_PERSONALITY_STATS.KILLS),
        row.get(RWFBOTS_PERSONALITY_STATS.DEATHS),
        row.get(RWFBOTS_PERSONALITY_STATS.PLANTS),
        row.get(RWFBOTS_PERSONALITY_STATS.DEFUSES),
        new Rating(row.get(RWFBOTS_PERSONALITY_STATS.MU), row.get(RWFBOTS_PERSONALITY_STATS.SIGMA)),
        Instant.ofEpochMilli(row.get(RWFBOTS_PERSONALITY_STATS.LAST_SEEN)));
  }
}
