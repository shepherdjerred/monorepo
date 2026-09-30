package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_USAGE;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.adapter.db.generated.tables.records.EssentialsTeleportUsageRecord;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Multiplier;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link TeleportUsageStore} over {@code essentials_teleport_usage}. */
public final class JooqTeleportUsageStore implements TeleportUsageStore {

  private final StormDatabase database;

  public JooqTeleportUsageStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Optional<TeleportUsage>> find(UUID player, TeleportKind kind) {
    return database.read(
        dsl ->
            dsl.selectFrom(ESSENTIALS_TELEPORT_USAGE)
                .where(ESSENTIALS_TELEPORT_USAGE.PLAYER.eq(player.toString()))
                .and(ESSENTIALS_TELEPORT_USAGE.KIND.eq(kind.id()))
                .fetchOptional(JooqTeleportUsageStore::toUsage));
  }

  @Override
  public CompletableFuture<Void> save(UUID player, TeleportKind kind, TeleportUsage usage) {
    var multiplier = usage.multiplier().hundredths();
    var lastUsed = usage.lastUsed().toEpochMilli();
    var cooldownUntil = usage.cooldownUntil().toEpochMilli();
    return database
        .write(
            dsl -> {
              dsl.insertInto(ESSENTIALS_TELEPORT_USAGE)
                  .set(ESSENTIALS_TELEPORT_USAGE.PLAYER, player.toString())
                  .set(ESSENTIALS_TELEPORT_USAGE.KIND, kind.id())
                  .set(ESSENTIALS_TELEPORT_USAGE.MULTIPLIER_HUNDREDTHS, multiplier)
                  .set(ESSENTIALS_TELEPORT_USAGE.LAST_USED_AT, lastUsed)
                  .set(ESSENTIALS_TELEPORT_USAGE.COOLDOWN_UNTIL, cooldownUntil)
                  .onConflict(ESSENTIALS_TELEPORT_USAGE.PLAYER, ESSENTIALS_TELEPORT_USAGE.KIND)
                  .doUpdate()
                  .set(ESSENTIALS_TELEPORT_USAGE.MULTIPLIER_HUNDREDTHS, multiplier)
                  .set(ESSENTIALS_TELEPORT_USAGE.LAST_USED_AT, lastUsed)
                  .set(ESSENTIALS_TELEPORT_USAGE.COOLDOWN_UNTIL, cooldownUntil)
                  .execute();
              return true;
            })
        .thenAccept(done -> {});
  }

  private static TeleportUsage toUsage(EssentialsTeleportUsageRecord row) {
    return new TeleportUsage(
        new Multiplier(row.getMultiplierHundredths()),
        Instant.ofEpochMilli(row.getLastUsedAt()),
        Instant.ofEpochMilli(row.getCooldownUntil()));
  }
}
