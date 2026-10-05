package com.shepherdjerred.thestorm.arena.adapter.db;

import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SURVIVAL_CREDITS;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SURVIVAL_TIPS;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SURVIVAL_TIP_PREFERENCES;
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
  public CompletableFuture<Tips> tips(UUID player) {
    return database.read(
        dsl -> {
          var seen =
              dsl
                  .select(ARENA_SURVIVAL_TIPS.TOPIC)
                  .from(ARENA_SURVIVAL_TIPS)
                  .where(ARENA_SURVIVAL_TIPS.PLAYER.eq(player.toString()))
                  .fetchSet(ARENA_SURVIVAL_TIPS.TOPIC)
                  .stream()
                  .map(com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey::decode)
                  .collect(java.util.stream.Collectors.toUnmodifiableSet());
          var enabled =
              dsl.select(ARENA_SURVIVAL_TIP_PREFERENCES.ENABLED)
                  .from(ARENA_SURVIVAL_TIP_PREFERENCES)
                  .where(ARENA_SURVIVAL_TIP_PREFERENCES.PLAYER.eq(player.toString()))
                  .fetchOptional()
                  .map(row -> row.value1() == 1)
                  .orElse(true);
          return new Tips(seen, enabled);
        });
  }

  @Override
  public CompletableFuture<Void> tip(
      UUID player, com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey key) {
    return Writes.done(
        database.write(
            dsl ->
                dsl.insertInto(ARENA_SURVIVAL_TIPS)
                    .set(ARENA_SURVIVAL_TIPS.PLAYER, player.toString())
                    .set(ARENA_SURVIVAL_TIPS.TOPIC, key.encode())
                    .onConflictDoNothing()
                    .execute()));
  }

  @Override
  public CompletableFuture<Void> tipsEnabled(UUID player, boolean enabled) {
    return Writes.done(
        database.write(
            dsl ->
                dsl.insertInto(ARENA_SURVIVAL_TIP_PREFERENCES)
                    .set(ARENA_SURVIVAL_TIP_PREFERENCES.PLAYER, player.toString())
                    .set(ARENA_SURVIVAL_TIP_PREFERENCES.ENABLED, enabled ? 1 : 0)
                    .onConflict(ARENA_SURVIVAL_TIP_PREFERENCES.PLAYER)
                    .doUpdate()
                    .set(ARENA_SURVIVAL_TIP_PREFERENCES.ENABLED, enabled ? 1 : 0)
                    .execute()));
  }

  @Override
  public CompletableFuture<Void> resetTips(UUID player) {
    return Writes.done(
        database.write(
            dsl ->
                dsl.deleteFrom(ARENA_SURVIVAL_TIPS)
                    .where(ARENA_SURVIVAL_TIPS.PLAYER.eq(player.toString()))
                    .execute()));
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
