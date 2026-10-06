package com.shepherdjerred.thestorm.mail.adapter.db;

import static com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables.MAIL_LETTERS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mail.adapter.db.generated.tables.records.MailLettersRecord;
import com.shepherdjerred.thestorm.mail.app.Letters;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Capacity and sender throttle checks share the insertion's writer transaction. */
public final class JooqLetters implements Letters {
  private final StormDatabase database;

  public JooqLetters(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Result<UUID, String>> send(Letter letter, Limits limits) {
    if (letter.text().isBlank()
        || letter.text().codePointCount(0, letter.text().length()) > limits.maxLength())
      return CompletableFuture.completedFuture(Result.err("The letter is empty or too long."));
    if (letter.sender().equals(letter.recipient()))
      return CompletableFuture.completedFuture(Result.err("You cannot mail yourself."));
    return database.write(
        dsl -> {
          var last =
              dsl.select(MAIL_LETTERS.SENT_AT)
                  .from(MAIL_LETTERS)
                  .where(MAIL_LETTERS.SENDER.eq(letter.sender().toString()))
                  .orderBy(MAIL_LETTERS.SENT_AT.desc())
                  .limit(1)
                  .fetchOne(MAIL_LETTERS.SENT_AT);
          if (last != null
              && letter
                  .sentAt()
                  .isBefore(Instant.ofEpochMilli(last).plusSeconds(limits.intervalSeconds())))
            return Result.err("Wait " + limits.intervalSeconds() + " seconds between letters.");
          if (dsl.fetchCount(
                  MAIL_LETTERS,
                  MAIL_LETTERS
                      .RECIPIENT
                      .eq(letter.recipient().toString())
                      .and(MAIL_LETTERS.DELETED.eq(0)))
              >= limits.inboxLimit()) return Result.err("That mailbox is full.");
          dsl.insertInto(MAIL_LETTERS)
              .set(MAIL_LETTERS.ID, letter.id().toString())
              .set(MAIL_LETTERS.SENDER, letter.sender().toString())
              .set(MAIL_LETTERS.SENDER_NAME, letter.senderName())
              .set(MAIL_LETTERS.RECIPIENT, letter.recipient().toString())
              .set(MAIL_LETTERS.TEXT, letter.text())
              .set(MAIL_LETTERS.SENT_AT, letter.sentAt().toEpochMilli())
              .set(MAIL_LETTERS.DELETED, 0)
              .execute();
          return Result.ok(letter.id());
        });
  }

  @Override
  public CompletableFuture<List<Letter>> inbox(UUID recipient) {
    return database.read(
        dsl ->
            dsl.selectFrom(MAIL_LETTERS)
                .where(MAIL_LETTERS.RECIPIENT.eq(recipient.toString()))
                .and(MAIL_LETTERS.DELETED.eq(0))
                .orderBy(MAIL_LETTERS.SENT_AT.desc())
                .fetch()
                .map(JooqLetters::letter));
  }

  @Override
  public CompletableFuture<Optional<Letter>> find(UUID recipient, UUID id) {
    return database.read(
        dsl ->
            Optional.ofNullable(
                    dsl.selectFrom(MAIL_LETTERS)
                        .where(MAIL_LETTERS.ID.eq(id.toString()))
                        .and(MAIL_LETTERS.RECIPIENT.eq(recipient.toString()))
                        .and(MAIL_LETTERS.DELETED.eq(0))
                        .fetchOne())
                .map(JooqLetters::letter));
  }

  @Override
  public CompletableFuture<Optional<Letter>> read(UUID recipient, UUID id, Instant at) {
    return database.write(
        dsl -> {
          var row =
              dsl.selectFrom(MAIL_LETTERS)
                  .where(MAIL_LETTERS.ID.eq(id.toString()))
                  .and(MAIL_LETTERS.RECIPIENT.eq(recipient.toString()))
                  .and(MAIL_LETTERS.DELETED.eq(0))
                  .fetchOne();
          if (row == null) return Optional.empty();
          if (row.getReadAt() == null)
            dsl.update(MAIL_LETTERS)
                .set(MAIL_LETTERS.READ_AT, at.toEpochMilli())
                .where(MAIL_LETTERS.ID.eq(id.toString()))
                .execute();
          return Optional.of(letter(row));
        });
  }

  @Override
  public CompletableFuture<Boolean> delete(UUID recipient, UUID id) {
    return database.write(
        dsl ->
            dsl.update(MAIL_LETTERS)
                    .set(MAIL_LETTERS.DELETED, 1)
                    .where(MAIL_LETTERS.ID.eq(id.toString()))
                    .and(MAIL_LETTERS.RECIPIENT.eq(recipient.toString()))
                    .and(MAIL_LETTERS.DELETED.eq(0))
                    .execute()
                == 1);
  }

  private static Letter letter(MailLettersRecord row) {
    return new Letter(
        UUID.fromString(row.getId()),
        UUID.fromString(row.getSender()),
        row.getSenderName(),
        UUID.fromString(row.getRecipient()),
        row.getText(),
        Instant.ofEpochMilli(row.getSentAt()),
        row.getReadAt() != null);
  }
}
