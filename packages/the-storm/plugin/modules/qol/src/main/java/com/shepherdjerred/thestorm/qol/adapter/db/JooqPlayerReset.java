package com.shepherdjerred.thestorm.qol.adapter.db;

import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVE;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVES;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVE_CLAIMS;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVE_CREATIONS;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_NOTICES;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_PLAYER;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_RTP_ATTEMPT;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Profiles, graves, handoff receipts, notices and RTP obligations for one account. */
public final class JooqPlayerReset {

  private final StormDatabase database;

  public JooqPlayerReset(StormDatabase database) {
    this.database = database;
  }

  public CompletableFuture<Void> reset(UUID player) {
    var id = player.toString();
    return database
        .write(
            dsl -> {
              var graves =
                  dsl.select(QOL_GRAVES.ID).from(QOL_GRAVES).where(QOL_GRAVES.OWNER.eq(id));
              dsl.deleteFrom(QOL_GRAVE_CLAIMS)
                  .where(QOL_GRAVE_CLAIMS.TAKER.eq(id).or(QOL_GRAVE_CLAIMS.GRAVE.in(graves)))
                  .execute();
              dsl.deleteFrom(QOL_GRAVE_CREATIONS).where(QOL_GRAVE_CREATIONS.OWNER.eq(id)).execute();
              dsl.deleteFrom(QOL_GRAVES).where(QOL_GRAVES.OWNER.eq(id)).execute();
              dsl.deleteFrom(QOL_GRAVE).where(QOL_GRAVE.OWNER.eq(id)).execute();
              dsl.deleteFrom(QOL_NOTICES).where(QOL_NOTICES.PLAYER.eq(id)).execute();
              dsl.deleteFrom(QOL_RTP_ATTEMPT).where(QOL_RTP_ATTEMPT.PLAYER.eq(id)).execute();
              dsl.deleteFrom(QOL_PLAYER).where(QOL_PLAYER.PLAYER.eq(id)).execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
