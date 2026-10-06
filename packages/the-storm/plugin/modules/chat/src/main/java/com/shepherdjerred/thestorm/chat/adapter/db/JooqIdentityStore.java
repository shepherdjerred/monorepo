package com.shepherdjerred.thestorm.chat.adapter.db;

import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_IDENTITY;

import com.shepherdjerred.thestorm.chat.app.IdentityStore;
import com.shepherdjerred.thestorm.chat.domain.Identity;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

/** SQLite identity store. No server state is accessed here. */
public final class JooqIdentityStore implements IdentityStore {
  private final StormDatabase database;

  public JooqIdentityStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Map<UUID, Identity>> load() {
    return database.read(
        dsl ->
            dsl.selectFrom(CHAT_IDENTITY).fetch().stream()
                .collect(
                    Collectors.toUnmodifiableMap(
                        row -> UUID.fromString(row.getPlayer()),
                        row ->
                            new Identity(
                                Optional.ofNullable(row.getNickname()),
                                row.getMessages() == 1,
                                row.getReplies() == 1,
                                row.getSocialSpy() == 1))));
  }

  @Override
  public CompletableFuture<Void> save(UUID player, Identity identity, Audit audit) {
    return database
        .write(
            dsl -> {
              dsl.insertInto(CHAT_IDENTITY)
                  .set(CHAT_IDENTITY.PLAYER, player.toString())
                  .set(CHAT_IDENTITY.NICKNAME, identity.nickname().orElse(null))
                  .set(
                      CHAT_IDENTITY.NICKNAME_KEY,
                      identity.nickname().map(name -> name.toLowerCase(Locale.ROOT)).orElse(null))
                  .set(CHAT_IDENTITY.MESSAGES, identity.messages() ? 1 : 0)
                  .set(CHAT_IDENTITY.REPLIES, identity.replies() ? 1 : 0)
                  .set(CHAT_IDENTITY.SOCIAL_SPY, identity.socialSpy() ? 1 : 0)
                  .onConflict(CHAT_IDENTITY.PLAYER)
                  .doUpdate()
                  .set(CHAT_IDENTITY.NICKNAME, identity.nickname().orElse(null))
                  .set(
                      CHAT_IDENTITY.NICKNAME_KEY,
                      identity.nickname().map(name -> name.toLowerCase(Locale.ROOT)).orElse(null))
                  .set(CHAT_IDENTITY.MESSAGES, identity.messages() ? 1 : 0)
                  .set(CHAT_IDENTITY.REPLIES, identity.replies() ? 1 : 0)
                  .set(CHAT_IDENTITY.SOCIAL_SPY, identity.socialSpy() ? 1 : 0)
                  .execute();
              var log =
                  com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_IDENTITY_AUDIT;
              dsl.insertInto(log)
                  .set(log.ACTOR, audit.actor().toString())
                  .set(log.TARGET, player.toString())
                  .set(log.ACTION, audit.action())
                  .set(log.AT, audit.at().toString())
                  .execute();
              return true;
            })
        .thenAccept(saved -> {});
  }
}
