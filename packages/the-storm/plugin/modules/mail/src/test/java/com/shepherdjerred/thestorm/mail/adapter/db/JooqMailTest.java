package com.shepherdjerred.thestorm.mail.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mail.app.Mail;
import com.shepherdjerred.thestorm.mail.app.MailItem;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Real SQLite checkpoints cover exclusive choices, retryable batches and interrupted delivery. */
final class JooqMailTest {
  @TempDir Path directory;
  private StormDatabase database;
  private JooqMail mail;
  private final UUID owner = UUID.randomUUID();
  private final UUID id = UUID.randomUUID();
  private static final MailItem FIRST = new MailItem(new byte[] {1, 2});
  private static final MailItem SECOND = new MailItem(new byte[] {3, 4});

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("mail.db"));
    database.migrate("mail", getClass().getClassLoader());
    mail = new JooqMail(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void postingIsIdempotentAndConflictingPayloadsFail() throws Exception {
    var message = message();
    await(mail.postOnce(message));
    await(mail.postOnce(message));
    assertThat(await(mail.list(owner))).hasSize(1);
    assertThatThrownBy(
            () -> await(mail.postOnce(new Mail.Message(id, owner, "Different", message.options()))))
        .hasRootCauseInstanceOf(IllegalStateException.class);
  }

  @Test
  void concurrentChoicesHaveExactlyOneWinner() throws Exception {
    await(mail.postOnce(message()));
    var materials = mail.reserve(new Mail.Claim(id, owner, "materials", 2, UUID.randomUUID()));
    var packed = mail.reserve(new Mail.Claim(id, owner, "packed", 2, UUID.randomUUID()));
    assertThat(List.of(await(materials).isOk(), await(packed).isOk())).containsExactly(true, false);
    assertThat(await(mail.selection(id, owner))).contains("materials");
    assertThat(await(mail.selection(id, UUID.randomUUID()))).isEmpty();
  }

  @Test
  void retryBeforeReceiptReusesBatchAndAckAdvancesExactlyOnce() throws Exception {
    await(mail.postOnce(message()));
    var first =
        ok(await(mail.reserve(new Mail.Claim(id, owner, "materials", 1, UUID.randomUUID()))));
    var retry =
        ok(await(mail.reserve(new Mail.Claim(id, owner, "materials", 1, UUID.randomUUID()))));
    assertThat(retry).isEqualTo(first);
    assertThat(first.items()).containsExactly(FIRST);
    await(mail.acknowledge(UUID.randomUUID(), first.token()));
    assertThat(
            ok(await(mail.reserve(new Mail.Claim(id, owner, "materials", 1, UUID.randomUUID())))))
        .isEqualTo(first);
    await(mail.acknowledge(owner, first.token()));
    await(mail.acknowledge(owner, first.token()));
    var second =
        ok(await(mail.reserve(new Mail.Claim(id, owner, "materials", 1, UUID.randomUUID()))));
    assertThat(second.items()).containsExactly(SECOND);
    await(mail.acknowledge(owner, second.token()));
    assertThat(await(mail.list(owner))).isEmpty();
    assertThat(
            await(mail.reserve(new Mail.Claim(id, owner, "packed", 1, UUID.randomUUID()))).isOk())
        .isFalse();
  }

  @Test
  void fullInventoryDoesNotSelectAnOptionAndEmptyMaterialsStillConsumeTheChoice() throws Exception {
    await(
        mail.postOnce(
            new Mail.Message(
                id,
                owner,
                "Empty build",
                Map.of("materials", List.of(), "packed", List.of(FIRST)))));
    assertThat(
            await(mail.reserve(new Mail.Claim(id, owner, "materials", 0, UUID.randomUUID())))
                .isOk())
        .isFalse();
    assertThat(await(mail.selection(id, owner))).isEqualTo(Optional.empty());
    var batch =
        ok(await(mail.reserve(new Mail.Claim(id, owner, "materials", 1, UUID.randomUUID()))));
    assertThat(batch.items()).isEmpty();
    await(mail.acknowledge(owner, batch.token()));
    assertThat(
            await(mail.reserve(new Mail.Claim(id, owner, "packed", 1, UUID.randomUUID()))).isOk())
        .isFalse();
  }

  @Test
  void pendingDeliverySurvivesDatabaseReopen() throws Exception {
    await(mail.postOnce(message()));
    var original =
        ok(await(mail.reserve(new Mail.Claim(id, owner, "packed", 1, UUID.randomUUID()))));
    database.close();
    open();
    assertThat(ok(await(mail.reserve(new Mail.Claim(id, owner, "packed", 1, UUID.randomUUID())))))
        .isEqualTo(original);
  }

  private Mail.Message message() {
    return new Mail.Message(
        id,
        owner,
        "Recovered shop",
        Map.of("materials", List.of(FIRST, SECOND), "packed", List.of(SECOND)));
  }

  private static Mail.Batch ok(Result<Mail.Batch, String> result) {
    return result.fold(
        value -> value,
        reason -> {
          throw new AssertionError(reason);
        });
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }
}
