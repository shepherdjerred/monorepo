package com.shepherdjerred.thestorm.chat.adapter.db;

import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_FOCUS;
import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_HIDDEN_CHANNEL;
import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_IDENTITY;
import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_IDENTITY_AUDIT;
import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_IGNORE;
import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_MUTE;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** All durable chat and identity state owned by one account. */
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
              dsl.deleteFrom(CHAT_FOCUS).where(CHAT_FOCUS.PLAYER.eq(id)).execute();
              dsl.deleteFrom(CHAT_HIDDEN_CHANNEL)
                  .where(CHAT_HIDDEN_CHANNEL.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(CHAT_IGNORE)
                  .where(CHAT_IGNORE.PLAYER.eq(id).or(CHAT_IGNORE.IGNORED.eq(id)))
                  .execute();
              dsl.deleteFrom(CHAT_MUTE).where(CHAT_MUTE.PLAYER.eq(id)).execute();
              dsl.deleteFrom(CHAT_IDENTITY).where(CHAT_IDENTITY.PLAYER.eq(id)).execute();
              dsl.deleteFrom(CHAT_IDENTITY_AUDIT)
                  .where(CHAT_IDENTITY_AUDIT.ACTOR.eq(id).or(CHAT_IDENTITY_AUDIT.TARGET.eq(id)))
                  .execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
