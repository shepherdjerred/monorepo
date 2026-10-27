package com.shepherdjerred.thestorm.mail.adapter.db;

import static com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables.MAIL_BATCHES;
import static com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables.MAIL_ITEMS;
import static com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables.MAIL_LETTERS;
import static com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables.MAIL_MESSAGES;
import static com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables.MAIL_OPTIONS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Mail, delivery batches and letters belonging to one account. */
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
              var messages =
                  dsl.select(MAIL_MESSAGES.MESSAGE_ID)
                      .from(MAIL_MESSAGES)
                      .where(MAIL_MESSAGES.OWNER_ID.eq(id));
              dsl.deleteFrom(MAIL_BATCHES).where(MAIL_BATCHES.OWNER_ID.eq(id)).execute();
              dsl.deleteFrom(MAIL_ITEMS).where(MAIL_ITEMS.MESSAGE_ID.in(messages)).execute();
              dsl.deleteFrom(MAIL_OPTIONS).where(MAIL_OPTIONS.MESSAGE_ID.in(messages)).execute();
              dsl.deleteFrom(MAIL_MESSAGES).where(MAIL_MESSAGES.OWNER_ID.eq(id)).execute();
              dsl.deleteFrom(MAIL_LETTERS)
                  .where(MAIL_LETTERS.SENDER.eq(id).or(MAIL_LETTERS.RECIPIENT.eq(id)))
                  .execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
