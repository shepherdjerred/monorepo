package com.shepherdjerred.thestorm.arena.adapter.db;

import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SETTLEMENT_BACKUPS;

import com.shepherdjerred.thestorm.arena.app.store.SettlementStore;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/** Provisioning never starts until its complete immutable backup commits. */
public final class JooqSettlementStore implements SettlementStore {
  private final StormDatabase database;

  public JooqSettlementStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> save(Backup backup) {
    return Writes.done(
        database.write(
            dsl ->
                dsl.insertInto(ARENA_SETTLEMENT_BACKUPS)
                    .set(ARENA_SETTLEMENT_BACKUPS.TOKEN, backup.token())
                    .set(ARENA_SETTLEMENT_BACKUPS.WORLD, backup.world())
                    .set(ARENA_SETTLEMENT_BACKUPS.CHANGES, SettlementCodec.encode(backup.changes()))
                    .set(ARENA_SETTLEMENT_BACKUPS.STATUS, backup.status().name())
                    .execute()));
  }

  @Override
  public CompletableFuture<Optional<Backup>> load(String token) {
    return database.read(
        dsl ->
            dsl.selectFrom(ARENA_SETTLEMENT_BACKUPS)
                .where(ARENA_SETTLEMENT_BACKUPS.TOKEN.eq(token))
                .fetchOptional(
                    row ->
                        new Backup(
                            row.getToken(),
                            row.getWorld(),
                            SettlementCodec.decode(row.getChanges()),
                            Status.valueOf(row.getStatus()))));
  }

  @Override
  public CompletableFuture<Void> status(String token, Status status) {
    return Writes.done(
        database.write(
            dsl -> {
              var updated =
                  dsl.update(ARENA_SETTLEMENT_BACKUPS)
                      .set(ARENA_SETTLEMENT_BACKUPS.STATUS, status.name())
                      .where(ARENA_SETTLEMENT_BACKUPS.TOKEN.eq(token))
                      .execute();
              if (updated != 1) {
                throw new IllegalStateException("Missing settlement backup " + token);
              }
              return updated;
            }));
  }
}
