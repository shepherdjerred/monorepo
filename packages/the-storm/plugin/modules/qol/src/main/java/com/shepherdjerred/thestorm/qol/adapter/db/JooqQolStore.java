package com.shepherdjerred.thestorm.qol.adapter.db;

import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_PLAYER;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_RTP_ATTEMPT;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.qol.app.Ensured;
import com.shepherdjerred.thestorm.qol.app.PlayerProfile;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import com.shepherdjerred.thestorm.qol.app.RtpAttempt;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;

/** {@link QolStore} in SQLite. */
public final class JooqQolStore implements QolStore {

  private final StormDatabase database;

  public JooqQolStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Ensured> ensure(UUID player, Instant now) {
    return database.write(dsl -> ensure(dsl, player, now));
  }

  @Override
  public CompletableFuture<Void> setLastRtp(UUID player, Instant when) {
    return write(
        dsl ->
            dsl.update(QOL_PLAYER)
                .set(QOL_PLAYER.LAST_RTP, when.toEpochMilli())
                .where(QOL_PLAYER.PLAYER.eq(player.toString()))
                .execute());
  }

  @Override
  public CompletableFuture<Void> insertRtpAttempt(RtpAttempt attempt) {
    return write(
        dsl ->
            dsl.insertInto(QOL_RTP_ATTEMPT)
                .set(QOL_RTP_ATTEMPT.ID, attempt.id().toString())
                .set(QOL_RTP_ATTEMPT.PLAYER, attempt.player().toString())
                .set(QOL_RTP_ATTEMPT.COST, attempt.cost())
                .execute());
  }

  @Override
  public CompletableFuture<Integer> spendStarterCharge(UUID player) {
    return database.write(
        dsl -> {
          dsl.update(QOL_PLAYER)
              .set(QOL_PLAYER.STARTER_RTP_CHARGES, QOL_PLAYER.STARTER_RTP_CHARGES.minus(1))
              .set(
                  QOL_PLAYER.STARTER_RTP_PENDING,
                  org.jooq
                      .impl
                      .DSL
                      .when(QOL_PLAYER.STARTER_RTP_CHARGES.minus(1).gt(0), 1)
                      .otherwise(0))
              .where(
                  QOL_PLAYER.PLAYER.eq(player.toString()).and(QOL_PLAYER.STARTER_RTP_CHARGES.gt(0)))
              .execute();
          var left =
              dsl.select(QOL_PLAYER.STARTER_RTP_CHARGES)
                  .from(QOL_PLAYER)
                  .where(QOL_PLAYER.PLAYER.eq(player.toString()))
                  .fetchOne(QOL_PLAYER.STARTER_RTP_CHARGES);
          return left == null ? 0 : left;
        });
  }

  @Override
  public CompletableFuture<Void> discardStarterCompass(UUID player) {
    return write(
        dsl ->
            dsl.update(QOL_PLAYER)
                .set(QOL_PLAYER.STARTER_RTP_CHARGES, 0)
                .set(QOL_PLAYER.STARTER_RTP_PENDING, 0)
                .where(QOL_PLAYER.PLAYER.eq(player.toString()))
                .execute());
  }

  @Override
  public CompletableFuture<List<RtpAttempt>> pendingRtpAttempts() {
    return database.read(
        dsl ->
            dsl.selectFrom(QOL_RTP_ATTEMPT)
                .fetch(
                    row ->
                        new RtpAttempt(
                            UUID.fromString(row.getId()),
                            UUID.fromString(row.getPlayer()),
                            row.getCost())));
  }

  @Override
  public CompletableFuture<Void> deleteRtpAttempt(UUID id) {
    return write(
        dsl ->
            dsl.deleteFrom(QOL_RTP_ATTEMPT).where(QOL_RTP_ATTEMPT.ID.eq(id.toString())).execute());
  }

  private CompletableFuture<Void> write(Consumer<DSLContext> work) {
    return database
        .write(
            dsl -> {
              work.accept(dsl);
              return Boolean.TRUE;
            })
        .thenAccept(done -> {});
  }

  private static Ensured ensure(DSLContext dsl, UUID player, Instant now) {
    var row = dsl.selectFrom(QOL_PLAYER).where(QOL_PLAYER.PLAYER.eq(player.toString())).fetchOne();
    if (row != null) {
      return new Ensured(profile(row), false);
    }
    dsl.insertInto(QOL_PLAYER)
        .set(QOL_PLAYER.PLAYER, player.toString())
        .set(QOL_PLAYER.FIRST_SEEN, now.toEpochMilli())
        .set(QOL_PLAYER.STARTER_RTP_PENDING, 1)
        .set(QOL_PLAYER.STARTER_RTP_CHARGES, PlayerProfile.STARTER_CHARGES)
        .execute();
    return new Ensured(
        new PlayerProfile(player, now, Optional.empty(), PlayerProfile.STARTER_CHARGES), true);
  }

  private static PlayerProfile profile(
      com.shepherdjerred.thestorm.qol.adapter.db.generated.tables.records.QolPlayerRecord row) {
    return new PlayerProfile(
        UUID.fromString(row.getPlayer()),
        Instant.ofEpochMilli(row.getFirstSeen()),
        instant(row.getLastRtp()),
        row.getStarterRtpCharges());
  }

  private static Optional<Instant> instant(@Nullable Long millis) {
    if (millis == null) {
      return Optional.empty();
    }
    return Optional.of(Instant.ofEpochMilli(millis));
  }
}
