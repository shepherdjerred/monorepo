package com.shepherdjerred.thestorm.mail.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.mail.app.Letters;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Transactional limits, recipient-only access, Unicode and restart durability. */
final class JooqLettersTest {
  @TempDir Path directory;
  private static final Instant NOW = Instant.parse("2026-10-04T12:00:00Z");
  private static final Letters.Limits LIMITS = new Letters.Limits(2000, 10, 1);

  private Letters.Letter letter(UUID sender, UUID recipient, Instant time, String text) {
    return new Letters.Letter(UUID.randomUUID(), sender, "Sender", recipient, text, time, false);
  }

  @Test
  void concurrentSendersCannotOverflowAndSenderCannotReadOrDelete() throws Exception {
    try (var db = StormDatabase.open(directory.resolve("mail.db"))) {
      db.migrate("mail", getClass().getClassLoader());
      var letters = new JooqLetters(db);
      var owner = UUID.randomUUID();
      var first = letter(UUID.randomUUID(), owner, NOW, "First");
      var second = letter(UUID.randomUUID(), owner, NOW, "Second");
      var sendFirst = letters.send(first, LIMITS);
      var sendSecond = letters.send(second, LIMITS);
      assertThat(List.of(await(sendFirst).isOk(), await(sendSecond).isOk()))
          .containsExactly(true, false);
      assertThat(await(letters.inbox(owner))).containsExactly(first);
      assertThat(await(letters.read(first.sender(), first.id(), NOW))).isEmpty();
      assertThat(await(letters.delete(first.sender(), first.id()))).isFalse();
      assertThat(await(letters.read(owner, first.id(), NOW))).isPresent();
      assertThat(await(letters.inbox(owner)).getFirst().read()).isTrue();
    }
  }

  @Test
  void deletionFreesCapacityButDoesNotResetSenderThrottle() throws Exception {
    try (var db = StormDatabase.open(directory.resolve("mail.db"))) {
      db.migrate("mail", getClass().getClassLoader());
      var letters = new JooqLetters(db);
      var sender = UUID.randomUUID();
      var owner = UUID.randomUUID();
      var first = letter(sender, owner, NOW, "Hello");
      assertThat(await(letters.send(first, LIMITS)).isOk()).isTrue();
      assertThat(await(letters.delete(owner, first.id()))).isTrue();
      assertThat(
              await(letters.send(letter(sender, owner, NOW.plusSeconds(9), "Again"), LIMITS))
                  .isOk())
          .isFalse();
      assertThat(
              await(letters.send(letter(sender, owner, NOW.plusSeconds(10), "Again"), LIMITS))
                  .isOk())
          .isTrue();
    }
    try (var db = StormDatabase.open(directory.resolve("mail.db"))) {
      db.migrate("mail", getClass().getClassLoader());
      int count =
          await(
              db.read(
                  sql ->
                      sql.fetchCount(
                          com.shepherdjerred.thestorm.mail.adapter.db.generated.Tables
                              .MAIL_LETTERS)));
      assertThat(count).isEqualTo(2);
    }
  }

  @Test
  void lengthUsesCodePointsAndSelfMailIsRefused() throws Exception {
    try (var db = StormDatabase.open(directory.resolve("mail.db"))) {
      db.migrate("mail", getClass().getClassLoader());
      var letters = new JooqLetters(db);
      var sender = UUID.randomUUID();
      var owner = UUID.randomUUID();
      assertThat(await(letters.send(letter(sender, sender, NOW, "Self"), LIMITS)).isOk()).isFalse();
      assertThat(await(letters.send(letter(sender, owner, NOW, "😀".repeat(2001)), LIMITS)).isOk())
          .isFalse();
      assertThat(await(letters.send(letter(sender, owner, NOW, "😀".repeat(2000)), LIMITS)).isOk())
          .isTrue();
    }
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }
}
