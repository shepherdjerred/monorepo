package com.shepherdjerred.thestorm.core.reset;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.table;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Table;

/** Reset policy survives deletion or rebuilding of every gameplay index. */
public final class SqlAccountEpochs implements AccountEpochs.Store {
  private static final Table<Record> EPOCHS = table("core_account_epoch");
  private static final Field<String> PLAYER = field("player", String.class);
  private static final Field<Long> GENERATION = field("generation", Long.class);
  private final StormDatabase database;

  public SqlAccountEpochs(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Map<UUID, Long>> load() {
    return database.read(sql ->
        sql.select(PLAYER, GENERATION)
            .from(EPOCHS)
            .fetchMap(row -> UUID.fromString(row.value1()), row -> row.value2()));
  }

  @Override
  public CompletableFuture<Long> advance(UUID player) {
    return database.write(sql -> {
      sql.insertInto(EPOCHS, PLAYER, GENERATION)
          .values(player.toString(), 1L)
          .onConflict(PLAYER)
          .doUpdate()
          .set(GENERATION, GENERATION.add(1L))
          .execute();
      return java.util.Objects.requireNonNull(
          sql.select(GENERATION)
              .from(EPOCHS)
              .where(PLAYER.eq(player.toString()))
              .fetchSingle(GENERATION));
    });
  }
}
