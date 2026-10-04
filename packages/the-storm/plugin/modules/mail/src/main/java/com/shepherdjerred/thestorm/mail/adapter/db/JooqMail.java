package com.shepherdjerred.thestorm.mail.adapter.db;

import static com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables.MAIL_BATCHES;
import static com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables.MAIL_ITEMS;
import static com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables.MAIL_MESSAGES;
import static com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables.MAIL_OPTIONS;
import static java.nio.charset.StandardCharsets.UTF_8;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mail.app.Mail;
import com.shepherdjerred.thestorm.mail.app.MailItem;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Exclusive option selection and delivery cursor advance are writer transactions. */
public final class JooqMail implements Mail {
  private final StormDatabase database;

  public JooqMail(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> postOnce(Message message) {
    var hash = hash(message);
    return database
        .write(
            dsl -> {
              var existing =
                  dsl.selectFrom(MAIL_MESSAGES)
                      .where(MAIL_MESSAGES.MESSAGE_ID.eq(message.id().toString()))
                      .fetchOne();
              if (existing != null) {
                if (!hash.equals(existing.getPayloadHash())) {
                  throw new IllegalStateException(
                      "mail id reused with different contents: " + message.id());
                }
                return false;
              }
              dsl.insertInto(MAIL_MESSAGES)
                  .set(MAIL_MESSAGES.MESSAGE_ID, message.id().toString())
                  .set(MAIL_MESSAGES.OWNER_ID, message.owner().toString())
                  .set(MAIL_MESSAGES.TITLE, message.title())
                  .set(MAIL_MESSAGES.PAYLOAD_HASH, hash)
                  .set(MAIL_MESSAGES.DELIVERED, 0)
                  .execute();
              message
                  .options()
                  .forEach(
                      (option, items) -> {
                        dsl.insertInto(MAIL_OPTIONS)
                            .set(MAIL_OPTIONS.MESSAGE_ID, message.id().toString())
                            .set(MAIL_OPTIONS.OPTION_ID, option)
                            .execute();
                        for (var i = 0; i < items.size(); i++) {
                          dsl.insertInto(MAIL_ITEMS)
                              .set(MAIL_ITEMS.MESSAGE_ID, message.id().toString())
                              .set(MAIL_ITEMS.OPTION_ID, option)
                              .set(MAIL_ITEMS.ITEM_INDEX, i)
                              .set(MAIL_ITEMS.ITEM, items.get(i).bytes())
                              .execute();
                        }
                      });
              return true;
            })
        .thenAccept(written -> {});
  }

  @Override
  public CompletableFuture<List<Summary>> list(UUID owner) {
    return database.read(
        dsl -> {
          var result = new ArrayList<Summary>();
          for (var row :
              dsl.selectFrom(MAIL_MESSAGES)
                  .where(MAIL_MESSAGES.OWNER_ID.eq(owner.toString()))
                  .fetch()) {
            var options =
                dsl.select(MAIL_OPTIONS.OPTION_ID)
                    .from(MAIL_OPTIONS)
                    .where(MAIL_OPTIONS.MESSAGE_ID.eq(row.getMessageId()))
                    .orderBy(MAIL_OPTIONS.OPTION_ID)
                    .fetch(MAIL_OPTIONS.OPTION_ID);
            var selected = row.getSelected();
            var count =
                selected == null
                    ? 0
                    : dsl.fetchCount(
                        MAIL_ITEMS,
                        MAIL_ITEMS
                            .MESSAGE_ID
                            .eq(row.getMessageId())
                            .and(MAIL_ITEMS.OPTION_ID.eq(selected)));
            if (selected == null || count > row.getDelivered()) {
              result.add(
                  new Summary(
                      UUID.fromString(row.getMessageId()),
                      row.getTitle(),
                      options,
                      selected == null ? "" : selected,
                      count - row.getDelivered()));
            }
          }
          return List.copyOf(result);
        });
  }

  @Override
  public CompletableFuture<Result<Batch, String>> reserve(Claim claim) {
    if (claim.capacity() < 1 || claim.capacity() > 36) {
      return CompletableFuture.completedFuture(Result.err("Make room in your inventory first."));
    }
    return database.write(dsl -> reserve(dsl, claim));
  }

  private static Result<Batch, String> reserve(org.jooq.DSLContext dsl, Claim claim) {
    var messageId = claim.messageId();
    var owner = claim.owner();
    var option = claim.option();
    var capacity = claim.capacity();
    var token = claim.token();
    var row =
        dsl.selectFrom(MAIL_MESSAGES)
            .where(MAIL_MESSAGES.MESSAGE_ID.eq(messageId.toString()))
            .and(MAIL_MESSAGES.OWNER_ID.eq(owner.toString()))
            .fetchOne();
    if (row == null) {
      return Result.err("That message is not in your mailbox.");
    }
    var selected = row.getSelected();
    if (!dsl.fetchExists(
        MAIL_OPTIONS,
        MAIL_OPTIONS.MESSAGE_ID.eq(messageId.toString()).and(MAIL_OPTIONS.OPTION_ID.eq(option)))) {
      return Result.err("Choose one of the options shown by /mail.");
    }
    if (selected != null && !selected.equals(option)) {
      return Result.err(
          "You already chose " + selected + ". The other option is no longer available.");
    }
    var pending =
        dsl.selectFrom(MAIL_BATCHES).where(MAIL_BATCHES.OWNER_ID.eq(owner.toString())).fetchOne();
    if (pending != null && !pending.getMessageId().equals(messageId.toString())) {
      return Result.err("Finish collecting your other message first.");
    }
    var start = pending == null ? row.getDelivered() : pending.getStartIndex();
    var end = pending == null ? start + capacity : pending.getEndIndex();
    var items =
        dsl.selectFrom(MAIL_ITEMS)
            .where(MAIL_ITEMS.MESSAGE_ID.eq(messageId.toString()))
            .and(MAIL_ITEMS.OPTION_ID.eq(option))
            .and(MAIL_ITEMS.ITEM_INDEX.ge(start))
            .and(MAIL_ITEMS.ITEM_INDEX.lt(end))
            .orderBy(MAIL_ITEMS.ITEM_INDEX)
            .fetch()
            .map(item -> new MailItem(item.getItem()));
    if (items.isEmpty() && selected != null) {
      return Result.err("No items remain for that option.");
    }
    if (items.size() > capacity) {
      return Result.err("Make room for " + items.size() + " item stacks to finish this delivery.");
    }
    if (pending == null) {
      dsl.update(MAIL_MESSAGES)
          .set(MAIL_MESSAGES.SELECTED, option)
          .where(MAIL_MESSAGES.MESSAGE_ID.eq(messageId.toString()))
          .execute();
      dsl.insertInto(MAIL_BATCHES)
          .set(MAIL_BATCHES.TOKEN_ID, token.toString())
          .set(MAIL_BATCHES.MESSAGE_ID, messageId.toString())
          .set(MAIL_BATCHES.OWNER_ID, owner.toString())
          .set(MAIL_BATCHES.START_INDEX, start)
          .set(MAIL_BATCHES.END_INDEX, start + items.size())
          .execute();
    }
    return Result.ok(
        new Batch(
            pending == null ? token : UUID.fromString(pending.getTokenId()),
            messageId,
            owner,
            items));
  }

  @Override
  public CompletableFuture<Void> acknowledge(UUID owner, UUID token) {
    return database
        .write(
            dsl -> {
              var row =
                  dsl.selectFrom(MAIL_BATCHES)
                      .where(MAIL_BATCHES.TOKEN_ID.eq(token.toString()))
                      .and(MAIL_BATCHES.OWNER_ID.eq(owner.toString()))
                      .fetchOne();
              if (row != null) {
                dsl.update(MAIL_MESSAGES)
                    .set(MAIL_MESSAGES.DELIVERED, row.getEndIndex())
                    .where(MAIL_MESSAGES.MESSAGE_ID.eq(row.getMessageId()))
                    .execute();
                dsl.deleteFrom(MAIL_BATCHES)
                    .where(MAIL_BATCHES.TOKEN_ID.eq(token.toString()))
                    .execute();
              }
              return true;
            })
        .thenAccept(written -> {});
  }

  @Override
  public CompletableFuture<Optional<String>> selection(UUID messageId, UUID owner) {
    return database.read(
        dsl ->
            Optional.ofNullable(
                dsl.select(MAIL_MESSAGES.SELECTED)
                    .from(MAIL_MESSAGES)
                    .where(MAIL_MESSAGES.MESSAGE_ID.eq(messageId.toString()))
                    .and(MAIL_MESSAGES.OWNER_ID.eq(owner.toString()))
                    .fetchOne(MAIL_MESSAGES.SELECTED)));
  }

  private static String hash(Message message) {
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      hashField(digest, message.owner().toString().getBytes(UTF_8));
      hashField(digest, message.title().getBytes(UTF_8));
      digest.update(
          java.nio.ByteBuffer.allocate(Integer.BYTES).putInt(message.options().size()).array());
      message.options().entrySet().stream()
          .sorted(java.util.Map.Entry.comparingByKey())
          .forEach(
              entry -> {
                hashField(digest, entry.getKey().getBytes(UTF_8));
                digest.update(
                    java.nio.ByteBuffer.allocate(Integer.BYTES)
                        .putInt(entry.getValue().size())
                        .array());
                for (var item : entry.getValue()) {
                  var bytes = item.bytes();
                  hashField(digest, bytes);
                }
              });
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is unavailable", e);
    }
  }

  private static void hashField(MessageDigest digest, byte[] bytes) {
    digest.update(java.nio.ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
    digest.update(bytes);
  }
}
