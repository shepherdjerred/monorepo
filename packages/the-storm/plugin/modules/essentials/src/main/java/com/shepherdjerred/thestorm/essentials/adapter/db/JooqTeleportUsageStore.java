package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_ATTEMPTS;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_STATE;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_USES;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore.Confirmation;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUse;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Shared history and charge confirmation in the database's serialized writer transaction. */
public final class JooqTeleportUsageStore implements TeleportUsageStore {
  private final StormDatabase database;

  public JooqTeleportUsageStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Optional<TeleportUsage>> find(UUID player, Instant since) {
    return database.read(
        dsl -> {
          var state =
              dsl.selectFrom(ESSENTIALS_TELEPORT_STATE)
                  .where(ESSENTIALS_TELEPORT_STATE.PLAYER.eq(player.toString()))
                  .fetchOne();
          if (state == null) {
            return Optional.empty();
          }
          var trips =
              dsl.selectFrom(ESSENTIALS_TELEPORT_USES)
                  .where(ESSENTIALS_TELEPORT_USES.PLAYER.eq(player.toString()))
                  .and(ESSENTIALS_TELEPORT_USES.COMPLETED_AT.gt(since.toEpochMilli()))
                  .orderBy(ESSENTIALS_TELEPORT_USES.COMPLETED_AT)
                  .fetch(
                      row ->
                          new TeleportUse(
                              Instant.ofEpochMilli(row.getCompletedAt()), row.getHalfPoints()));
          return Optional.of(
              new TeleportUsage(trips, Instant.ofEpochMilli(state.getCooldownUntil())));
        });
  }

  @Override
  public CompletableFuture<Void> confirm(Confirmation confirmation) {
    var player = confirmation.player();
    var operation = confirmation.operation();
    var kind = confirmation.kind();
    var usage = confirmation.usage();
    var retainSince = confirmation.retainSince();
    var trip = usage.trips().getLast();
    return database
        .write(
            dsl -> {
              var inserted =
                  dsl.insertInto(ESSENTIALS_TELEPORT_USES)
                      .set(ESSENTIALS_TELEPORT_USES.ID, operation.toString())
                      .set(ESSENTIALS_TELEPORT_USES.PLAYER, player.toString())
                      .set(ESSENTIALS_TELEPORT_USES.KIND, kind.id())
                      .set(ESSENTIALS_TELEPORT_USES.HALF_POINTS, trip.halfPoints())
                      .set(ESSENTIALS_TELEPORT_USES.COMPLETED_AT, trip.at().toEpochMilli())
                      .onConflict(ESSENTIALS_TELEPORT_USES.ID)
                      .doNothing()
                      .execute();
              if (inserted == 1) {
                dsl.insertInto(ESSENTIALS_TELEPORT_STATE)
                    .set(ESSENTIALS_TELEPORT_STATE.PLAYER, player.toString())
                    .set(
                        ESSENTIALS_TELEPORT_STATE.COOLDOWN_UNTIL,
                        usage.cooldownUntil().toEpochMilli())
                    .onConflict(ESSENTIALS_TELEPORT_STATE.PLAYER)
                    .doUpdate()
                    .set(
                        ESSENTIALS_TELEPORT_STATE.COOLDOWN_UNTIL,
                        org.jooq.impl.DSL.greatest(
                            ESSENTIALS_TELEPORT_STATE.COOLDOWN_UNTIL,
                            org.jooq.impl.DSL.val(usage.cooldownUntil().toEpochMilli())))
                    .execute();
              } else {
                var previous =
                    java.util.Objects.requireNonNull(
                        dsl.selectFrom(ESSENTIALS_TELEPORT_USES)
                            .where(ESSENTIALS_TELEPORT_USES.ID.eq(operation.toString()))
                            .fetchOne());
                if (!previous.getPlayer().equals(player.toString())
                    || !previous.getKind().equals(kind.id())
                    || previous.getHalfPoints() != trip.halfPoints()) {
                  throw new IllegalStateException(
                      "teleport confirmation disagrees with its recorded operation");
                }
              }
              dsl.deleteFrom(ESSENTIALS_TELEPORT_USES)
                  .where(ESSENTIALS_TELEPORT_USES.PLAYER.eq(player.toString()))
                  .and(ESSENTIALS_TELEPORT_USES.COMPLETED_AT.le(retainSince.toEpochMilli()))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_TELEPORT_ATTEMPTS)
                  .where(ESSENTIALS_TELEPORT_ATTEMPTS.ID.eq(operation.toString()))
                  .execute();
              return Boolean.TRUE;
            })
        .thenAccept(done -> {});
  }
}
