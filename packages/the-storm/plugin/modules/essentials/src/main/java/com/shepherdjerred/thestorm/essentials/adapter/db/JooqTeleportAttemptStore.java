package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_ATTEMPTS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.app.TeleportAttempt;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportAttemptStore;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link TeleportAttemptStore} over SQLite. */
public final class JooqTeleportAttemptStore implements TeleportAttemptStore {

  private final StormDatabase database;

  public JooqTeleportAttemptStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> insert(TeleportAttempt attempt) {
    return database
        .write(
            dsl ->
                dsl.insertInto(ESSENTIALS_TELEPORT_ATTEMPTS)
                    .set(ESSENTIALS_TELEPORT_ATTEMPTS.ID, attempt.id().toString())
                    .set(ESSENTIALS_TELEPORT_ATTEMPTS.PAYER, attempt.payer().toString())
                    .set(ESSENTIALS_TELEPORT_ATTEMPTS.KIND, attempt.kind().id())
                    .set(ESSENTIALS_TELEPORT_ATTEMPTS.COST, attempt.cost())
                    .execute())
        .thenAccept(ignored -> {});
  }

  @Override
  public CompletableFuture<List<TeleportAttempt>> pending() {
    return database.read(
        dsl ->
            dsl.selectFrom(ESSENTIALS_TELEPORT_ATTEMPTS)
                .fetch(
                    row ->
                        new TeleportAttempt(
                            UUID.fromString(row.getId()),
                            UUID.fromString(row.getPayer()),
                            TeleportKind.fromId(row.getKind()),
                            row.getCost())));
  }

  @Override
  public CompletableFuture<Void> delete(UUID id) {
    return database
        .write(
            dsl ->
                dsl.deleteFrom(ESSENTIALS_TELEPORT_ATTEMPTS)
                    .where(ESSENTIALS_TELEPORT_ATTEMPTS.ID.eq(id.toString()))
                    .execute())
        .thenAccept(ignored -> {});
  }
}
