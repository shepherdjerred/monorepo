package com.shepherdjerred.thestorm.discord.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.app.MessagingPolicy;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.discord.app.DiscordCommand;
import com.shepherdjerred.thestorm.mail.app.Letters;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.slf4j.LoggerFactory;

/** Discord /mail goes through the same gates and filters as /mail send in game. */
final class DiscordMailTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  private static final Instant T0 = Instant.parse("2026-10-11T12:00:00Z");

  private final List<Letters.Letter> sent = new ArrayList<>();
  private final List<MessagingPolicy.Attempt> attempts = new ArrayList<>();
  private final List<String> delivered = new ArrayList<>();
  private final Set<String> closed = new HashSet<>();
  private final List<String> replies = new ArrayList<>();
  private DiscordCommand command;

  @BeforeEach
  void start() {
    var server = MockBukkit.mock();
    var players = Map.of("alice", ALICE, "bob", BOB);
    var directory =
        new PlayerDirectory() {
          @Override
          public CompletableFuture<Optional<KnownPlayer>> byName(String name) {
            return CompletableFuture.completedFuture(
                Optional.ofNullable(players.get(name.toLowerCase(java.util.Locale.ROOT)))
                    .map(id -> new KnownPlayer(id, id.equals(ALICE) ? "Alice" : "Bob", T0)));
          }

          @Override
          public CompletableFuture<Optional<KnownPlayer>> byId(UUID uuid) {
            return CompletableFuture.completedFuture(
                Optional.of(new KnownPlayer(uuid, uuid.equals(ALICE) ? "Alice" : "Bob", T0)));
          }
        };
    var letters =
        new Letters() {
          @Override
          public CompletableFuture<Result<UUID, String>> send(Letter letter, Limits limits) {
            sent.add(letter);
            return CompletableFuture.completedFuture(Result.ok(letter.id()));
          }

          @Override
          public CompletableFuture<List<Letter>> inbox(UUID recipient) {
            throw new UnsupportedOperationException();
          }

          @Override
          public CompletableFuture<Optional<Letter>> find(UUID recipient, UUID letter) {
            throw new UnsupportedOperationException();
          }

          @Override
          public CompletableFuture<Optional<Letter>> read(UUID recipient, UUID letter, Instant at) {
            throw new UnsupportedOperationException();
          }

          @Override
          public CompletableFuture<Boolean> delete(UUID recipient, UUID letter) {
            throw new UnsupportedOperationException();
          }
        };
    var policy =
        new MessagingPolicy() {
          @Override
          public Result<String, String> letter(Attempt attempt) {
            attempts.add(attempt);
            return attempt.text().contains("rude")
                ? Result.err("That letter breaks the chat rules.")
                : Result.ok(attempt.text());
          }

          @Override
          public void delivered(UUID sender, String text) {
            delivered.add(text);
          }
        };
    var gameplay =
        new ManagedGameplay(
            (key, id) -> CompletableFuture.completedFuture(!closed.contains(key + ":" + id)),
            () -> {});
    command =
        new DiscordMail(
                new DiscordMail.Ports(
                    letters, new Letters.Limits(200, 10, 100), gameplay, policy, directory),
                new DiscordMail.Side(
                    server,
                    Runnable::run,
                    () -> T0,
                    new SplittableRandom(1),
                    LoggerFactory.getLogger(DiscordMailTest.class)))
            .command();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private void mail(Optional<UUID> sender, String to, String text) {
    command
        .handler()
        .answer(
            new DiscordCommand.Request(Map.of("player", to, "text", text), 42L, sender),
            replies::add);
  }

  @Test
  void anUnlinkedDiscordUserCannotSendLetters() {
    mail(Optional.empty(), "bob", "hello");

    assertThat(replies).containsExactly("Link your account first: use /link here.");
    assertThat(sent).isEmpty();
  }

  @Test
  void aLinkedPlayerSendsAFilteredLetterWithoutStaffPowers() {
    mail(Optional.of(ALICE), "Bob", " hello there ");

    assertThat(replies).containsExactly("Letter sent to Bob.");
    assertThat(sent)
        .singleElement()
        .satisfies(
            letter -> {
              assertThat(letter.sender()).isEqualTo(ALICE);
              assertThat(letter.senderName()).isEqualTo("Alice");
              assertThat(letter.recipient()).isEqualTo(BOB);
              assertThat(letter.text()).isEqualTo("hello there");
            });
    assertThat(attempts)
        .singleElement()
        .satisfies(
            attempt -> {
              assertThat(attempt.staff()).isFalse();
              assertThat(attempt.bypass()).isFalse();
            });
    assertThat(delivered).containsExactly("hello there");
  }

  @Test
  void theFiltersAndRolloutGatesStillApply() {
    mail(Optional.of(ALICE), "bob", "rude words");
    closed.add(ManagedGameplay.LETTERS + ":" + BOB);
    mail(Optional.of(ALICE), "bob", "hello");
    mail(Optional.of(ALICE), "carol", "hello");

    assertThat(replies)
        .containsExactly(
            "That letter breaks the chat rules.",
            "Letters are not available for that player.",
            "carol has never played here.");
    assertThat(sent).isEmpty();
  }
}
