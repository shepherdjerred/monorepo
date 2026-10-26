package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_ATTEMPTS;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_CONFIRMATIONS;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_COOLDOWNS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore.Confirmation;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.impl.DSL;

/** Per-command cooldowns and charge confirmation in one writer transaction. */
public final class JooqTeleportUsageStore implements TeleportUsageStore {
  private final StormDatabase database;

  public JooqTeleportUsageStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Optional<TeleportUsage>> find(UUID player) {
    return database.read(
        dsl -> {
          var rows =
              dsl.selectFrom(ESSENTIALS_TELEPORT_COOLDOWNS)
                  .where(ESSENTIALS_TELEPORT_COOLDOWNS.PLAYER.eq(player.toString()))
                  .fetch();
          if (rows.isEmpty()) {
            return Optional.empty();
          }
          var until = new EnumMap<TeleportKind, Instant>(TeleportKind.class);
          for (var row : rows) {
            until.put(
                TeleportKind.fromId(row.getKind()), Instant.ofEpochMilli(row.getCooldownUntil()));
          }
          return Optional.of(new TeleportUsage(until));
        });
  }

  @Override
  public CompletableFuture<Void> confirm(Confirmation confirmation) {
    var player = confirmation.player().toString();
    var operation = confirmation.operation().toString();
    var kind = confirmation.kind().id();
    var until = confirmation.cooldownUntil().toEpochMilli();
    return database
        .write(
            dsl -> {
              var inserted =
                  dsl.insertInto(ESSENTIALS_TELEPORT_CONFIRMATIONS)
                      .set(ESSENTIALS_TELEPORT_CONFIRMATIONS.ID, operation)
                      .set(ESSENTIALS_TELEPORT_CONFIRMATIONS.PLAYER, player)
                      .set(ESSENTIALS_TELEPORT_CONFIRMATIONS.KIND, kind)
                      .set(ESSENTIALS_TELEPORT_CONFIRMATIONS.COOLDOWN_UNTIL, until)
                      .onConflict(ESSENTIALS_TELEPORT_CONFIRMATIONS.ID)
                      .doNothing()
                      .execute();
              if (inserted == 1) {
                dsl.insertInto(ESSENTIALS_TELEPORT_COOLDOWNS)
                    .set(ESSENTIALS_TELEPORT_COOLDOWNS.PLAYER, player)
                    .set(ESSENTIALS_TELEPORT_COOLDOWNS.KIND, kind)
                    .set(ESSENTIALS_TELEPORT_COOLDOWNS.COOLDOWN_UNTIL, until)
                    .onConflict(
                        ESSENTIALS_TELEPORT_COOLDOWNS.PLAYER, ESSENTIALS_TELEPORT_COOLDOWNS.KIND)
                    .doUpdate()
                    .set(
                        ESSENTIALS_TELEPORT_COOLDOWNS.COOLDOWN_UNTIL,
                        DSL.greatest(ESSENTIALS_TELEPORT_COOLDOWNS.COOLDOWN_UNTIL, DSL.val(until)))
                    .execute();
              } else {
                var previous =
                    Objects.requireNonNull(
                        dsl.selectFrom(ESSENTIALS_TELEPORT_CONFIRMATIONS)
                            .where(ESSENTIALS_TELEPORT_CONFIRMATIONS.ID.eq(operation))
                            .fetchOne());
                if (!previous.getPlayer().equals(player) || !previous.getKind().equals(kind)) {
                  throw new IllegalStateException(
                      "teleport confirmation disagrees with its recorded operation");
                }
              }
              dsl.deleteFrom(ESSENTIALS_TELEPORT_ATTEMPTS)
                  .where(ESSENTIALS_TELEPORT_ATTEMPTS.ID.eq(operation))
                  .execute();
              return Boolean.TRUE;
            })
        .thenAccept(done -> {});
  }
}
