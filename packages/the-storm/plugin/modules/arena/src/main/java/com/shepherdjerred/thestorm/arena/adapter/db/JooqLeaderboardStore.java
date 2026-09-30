package com.shepherdjerred.thestorm.arena.adapter.db;

import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_BEST_WAVES;

import com.shepherdjerred.thestorm.arena.app.ArenaRecords;
import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.List;
import java.util.OptionalInt;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link LeaderboardStore} over {@code arena_best_waves}; also the published records port. */
public final class JooqLeaderboardStore implements LeaderboardStore, ArenaRecords {

  private final StormDatabase database;

  public JooqLeaderboardStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> record(Result result) {
    return Writes.done(
        database.write(
            dsl -> {
              var player = result.player().toString();
              var best =
                  dsl.select(ARENA_BEST_WAVES.BEST_WAVE)
                      .from(ARENA_BEST_WAVES)
                      .where(ARENA_BEST_WAVES.PLAYER.eq(player))
                      .and(ARENA_BEST_WAVES.ARENA.eq(result.arena()))
                      .fetchOptional(ARENA_BEST_WAVES.BEST_WAVE);
              if (best.isPresent() && best.orElseThrow() >= result.wave()) {
                return dsl.update(ARENA_BEST_WAVES)
                    .set(ARENA_BEST_WAVES.NAME, result.name())
                    .where(ARENA_BEST_WAVES.PLAYER.eq(player))
                    .and(ARENA_BEST_WAVES.ARENA.eq(result.arena()))
                    .execute();
              }
              return dsl.insertInto(ARENA_BEST_WAVES)
                  .set(ARENA_BEST_WAVES.PLAYER, player)
                  .set(ARENA_BEST_WAVES.ARENA, result.arena())
                  .set(ARENA_BEST_WAVES.NAME, result.name())
                  .set(ARENA_BEST_WAVES.BEST_WAVE, result.wave())
                  .set(ARENA_BEST_WAVES.REACHED_AT, result.at().toEpochMilli())
                  .onConflict(ARENA_BEST_WAVES.PLAYER, ARENA_BEST_WAVES.ARENA)
                  .doUpdate()
                  .set(ARENA_BEST_WAVES.NAME, result.name())
                  .set(ARENA_BEST_WAVES.BEST_WAVE, result.wave())
                  .set(ARENA_BEST_WAVES.REACHED_AT, result.at().toEpochMilli())
                  .execute();
            }));
  }

  @Override
  public CompletableFuture<List<Standing>> top(String arena, int limit) {
    return database.read(
        dsl ->
            dsl.select(ARENA_BEST_WAVES.NAME, ARENA_BEST_WAVES.BEST_WAVE)
                .from(ARENA_BEST_WAVES)
                .where(ARENA_BEST_WAVES.ARENA.eq(arena))
                .orderBy(ARENA_BEST_WAVES.BEST_WAVE.desc(), ARENA_BEST_WAVES.REACHED_AT.asc())
                .limit(limit)
                .fetch(row -> new Standing(row.value1(), row.value2())));
  }

  @Override
  public CompletableFuture<OptionalInt> best(UUID player, String arena) {
    return database.read(
        dsl ->
            dsl.select(ARENA_BEST_WAVES.BEST_WAVE)
                .from(ARENA_BEST_WAVES)
                .where(ARENA_BEST_WAVES.PLAYER.eq(player.toString()))
                .and(ARENA_BEST_WAVES.ARENA.eq(arena))
                .fetchOptional(ARENA_BEST_WAVES.BEST_WAVE)
                .map(OptionalInt::of)
                .orElseGet(OptionalInt::empty));
  }

  @Override
  public CompletableFuture<OptionalInt> bestWave(UUID player, String arena) {
    return best(player, arena);
  }
}
