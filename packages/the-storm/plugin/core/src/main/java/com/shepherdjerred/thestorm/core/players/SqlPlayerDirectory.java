package com.shepherdjerred.thestorm.core.players;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.lower;
import static org.jooq.impl.DSL.table;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Table;

/** The {@link PlayerDirectory} over the {@code core_player} table. */
public final class SqlPlayerDirectory implements PlayerDirectory {

  private static final Table<Record> PLAYER = table("core_player");
  private static final Field<String> UUID_FIELD = field("uuid", String.class);
  private static final Field<String> NAME = field("last_name", String.class);
  private static final Field<Long> SEEN = field("last_seen", Long.class);

  private final StormDatabase database;

  public SqlPlayerDirectory(StormDatabase database) {
    this.database = database;
  }

  /** Records that {@code uuid} joined as {@code name} at {@code at}. */
  public CompletableFuture<Void> recordJoin(UUID uuid, String name, Instant at) {
    return database
        .write(
            dsl ->
                dsl.insertInto(PLAYER, UUID_FIELD, NAME, SEEN)
                    .values(uuid.toString(), name, at.toEpochMilli())
                    .onConflict(UUID_FIELD)
                    .doUpdate()
                    .set(NAME, name)
                    .set(SEEN, at.toEpochMilli())
                    .execute())
        .thenAccept(rows -> {});
  }

  @Override
  public CompletableFuture<Optional<KnownPlayer>> byName(String name) {
    var lowered = name.toLowerCase(Locale.ROOT);
    return database.read(
        dsl ->
            dsl.select(UUID_FIELD, NAME, SEEN)
                .from(PLAYER)
                .where(lower(NAME).eq(lowered))
                .orderBy(SEEN.desc())
                .limit(1)
                .fetchOptional(SqlPlayerDirectory::toPlayer));
  }

  @Override
  public CompletableFuture<Optional<KnownPlayer>> byId(UUID uuid) {
    return database.read(
        dsl ->
            dsl.select(UUID_FIELD, NAME, SEEN)
                .from(PLAYER)
                .where(UUID_FIELD.eq(uuid.toString()))
                .fetchOptional(SqlPlayerDirectory::toPlayer));
  }

  private static KnownPlayer toPlayer(Record row) {
    return new KnownPlayer(
        UUID.fromString(row.get(UUID_FIELD)), row.get(NAME), Instant.ofEpochMilli(row.get(SEEN)));
  }
}
