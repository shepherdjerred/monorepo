package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_STAFF_AUDIT;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_STAFF_STATE;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.app.StaffStore;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** SQLite staff state. */
public final class JooqStaffStore implements StaffStore {
  private final StormDatabase database;

  public JooqStaffStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<Entry>> load() {
    return database.read(
        sql ->
            sql.selectFrom(ESSENTIALS_STAFF_STATE)
                .fetch(row -> new Entry(row.getKind(), row.getId(), row.getValue())));
  }

  @Override
  public CompletableFuture<Void> write(List<Entry> entries, Audit audit) {
    return database
        .write(
            sql -> {
              for (var entry : entries) {
                sql.insertInto(ESSENTIALS_STAFF_STATE)
                    .set(ESSENTIALS_STAFF_STATE.KIND, entry.kind())
                    .set(ESSENTIALS_STAFF_STATE.ID, entry.id())
                    .set(ESSENTIALS_STAFF_STATE.VALUE, entry.value())
                    .onConflict(ESSENTIALS_STAFF_STATE.KIND, ESSENTIALS_STAFF_STATE.ID)
                    .doUpdate()
                    .set(ESSENTIALS_STAFF_STATE.VALUE, entry.value())
                    .execute();
              }
              sql.insertInto(ESSENTIALS_STAFF_AUDIT)
                  .set(ESSENTIALS_STAFF_AUDIT.ACTOR, audit.actor())
                  .set(ESSENTIALS_STAFF_AUDIT.COMMAND, audit.command())
                  .set(ESSENTIALS_STAFF_AUDIT.TARGETS, audit.targets())
                  .set(ESSENTIALS_STAFF_AUDIT.AT, audit.at().toString())
                  .execute();
              return true;
            })
        .thenAccept(_ -> {});
  }
}
