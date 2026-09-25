package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_MODERATION_LOG;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.adapter.db.generated.tables.records.EssentialsModerationLogRecord;
import com.shepherdjerred.thestorm.essentials.app.store.ModerationLogStore;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Actor;
import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import com.shepherdjerred.thestorm.essentials.domain.moderation.ModerationAction;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link ModerationLogStore} over {@code essentials_moderation_log}. Rows are never updated. */
public final class JooqModerationLogStore implements ModerationLogStore {

  private final StormDatabase database;

  public JooqModerationLogStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> append(AuditEntry entry) {
    return database
        .write(
            dsl -> {
              dsl.insertInto(ESSENTIALS_MODERATION_LOG)
                  .set(ESSENTIALS_MODERATION_LOG.TARGET, entry.target().toString())
                  .set(ESSENTIALS_MODERATION_LOG.ACTION, entry.action().id())
                  .set(
                      ESSENTIALS_MODERATION_LOG.ACTOR,
                      entry.actor().uuid().map(UUID::toString).orElse(null))
                  .set(ESSENTIALS_MODERATION_LOG.ACTOR_NAME, entry.actor().name())
                  .set(ESSENTIALS_MODERATION_LOG.REASON, entry.reason())
                  .set(ESSENTIALS_MODERATION_LOG.AT, entry.at().toEpochMilli())
                  .set(
                      ESSENTIALS_MODERATION_LOG.EXPIRES_AT,
                      entry.expiresAt().map(Instant::toEpochMilli).orElse(null))
                  .execute();
              return true;
            })
        .thenAccept(done -> {});
  }

  @Override
  public CompletableFuture<List<AuditEntry>> all() {
    return database.read(
        dsl ->
            dsl.selectFrom(ESSENTIALS_MODERATION_LOG)
                .orderBy(ESSENTIALS_MODERATION_LOG.ID)
                .fetch(JooqModerationLogStore::toEntry));
  }

  @Override
  public CompletableFuture<List<AuditEntry>> history(UUID target, int limit) {
    return database.read(
        dsl ->
            dsl.selectFrom(ESSENTIALS_MODERATION_LOG)
                .where(ESSENTIALS_MODERATION_LOG.TARGET.eq(target.toString()))
                .orderBy(ESSENTIALS_MODERATION_LOG.ID.desc())
                .limit(limit)
                .fetch(JooqModerationLogStore::toEntry));
  }

  private static AuditEntry toEntry(EssentialsModerationLogRecord row) {
    var actorId = Optional.ofNullable(row.getActor()).map(UUID::fromString);
    return new AuditEntry(
        UUID.fromString(row.getTarget()),
        ModerationAction.fromId(row.getAction()),
        new Actor(actorId, row.getActorName()),
        row.getReason(),
        Instant.ofEpochMilli(row.getAt()),
        Optional.ofNullable(row.getExpiresAt()).map(Instant::ofEpochMilli));
  }
}
