package com.shepherdjerred.thestorm.arena.adapter.db;

import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SURVIVAL_CREDITS;
import static org.jooq.impl.DSL.coalesce;
import static org.jooq.impl.DSL.sum;

import com.shepherdjerred.thestorm.arena.app.store.SurvivalProgress;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/** A credit's unique key makes retries and repeated encounter callbacks harmless. */
public final class JooqSurvivalProgress implements SurvivalProgress {
  private final StormDatabase database;

  public JooqSurvivalProgress(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Long> xp(UUID player) {
    return database.read(dsl -> total(dsl, player));
  }

  @Override
  public CompletableFuture<Long> credit(Credit credit) {
    return database.write(
        dsl -> {
          dsl.insertInto(ARENA_SURVIVAL_CREDITS)
              .set(ARENA_SURVIVAL_CREDITS.PLAYER, credit.player().toString())
              .set(ARENA_SURVIVAL_CREDITS.RUN, credit.run().toString())
              .set(ARENA_SURVIVAL_CREDITS.EVENT, credit.event())
              .set(ARENA_SURVIVAL_CREDITS.XP, credit.xp())
              .onConflictDoNothing()
              .execute();
          return total(dsl, credit.player());
        });
  }

  private static long total(DSLContext dsl, UUID player) {
    return dsl.select(coalesce(sum(ARENA_SURVIVAL_CREDITS.XP), java.math.BigDecimal.ZERO))
        .from(ARENA_SURVIVAL_CREDITS)
        .where(ARENA_SURVIVAL_CREDITS.PLAYER.eq(player.toString()))
        .fetchSingle()
        .value1()
        .longValueExact();
  }
}
