package com.shepherdjerred.thestorm.safety.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.safety.ContentReview;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import com.shepherdjerred.thestorm.safety.adapter.db.JooqEvidenceStore;
import java.nio.file.Path;
import java.time.Instant;
import java.time.InstantSource;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class SafetyServiceTest {
  @TempDir Path directory;
  private static final UUID ALICE = new UUID(1, 1);
  private static final Instant NOW = Instant.parse("2026-10-16T12:00:00Z");
  private static final SafetyConfig CONFIG =
      new SafetyConfig("http://localhost:3000", "TEST", 1000, 30, 32);

  private static ContentReview allow() {
    return new ContentReview(
        "allow", "none", 1, "Allowed.", "fixture", 0, 0, java.util.Map.of(), true);
  }

  private static ContentSubmission submission(String text) {
    return new ContentSubmission(UUID.randomUUID(), ALICE, "Alice", "chat", "global", text, "", "");
  }

  private StormDatabase database() {
    var database = StormDatabase.open(directory.resolve("evidence.db"));
    database.migrate("safety", getClass().getClassLoader());
    return database;
  }

  @Test
  void abusiveDiscordDisplayNamesCannotPublishABenignBody() {
    try (var db = database()) {
      var calls = new AtomicInteger();
      var service =
          new SafetyService(
              new JooqEvidenceStore(db),
              (submission, text, context) -> {
                calls.incrementAndGet();
                return CompletableFuture.completedFuture(allow());
              },
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));
      service.penalties(request -> CompletableFuture.completedFuture(null));
      var request =
          new ContentSubmission(
              UUID.randomUUID(), ALICE, "n" + "igger", "discord", "global", "hello", "", "message");
      var review = service.check(request).join();
      assertThat(review.allowed()).isFalse();
      assertThat(review.category()).isEqualTo("hate");
      assertThat(calls.get()).isZero();
    }
  }

  @Test
  void batchedActivityUsesTheSameCredentialRedactionAsAdmission() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var service =
          new SafetyService(
              store,
              (submission, text, context) -> CompletableFuture.completedFuture(allow()),
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));
      var credential = "sk-proj-" + "a".repeat(24);
      var activity =
          new ContentSubmission(
              UUID.randomUUID(),
              ALICE,
              "Alice",
              "activity",
              "staff",
              credential,
              credential,
              credential);
      service
          .observeBatch(java.util.List.of(new EvidenceStore.Observation(activity, "observed", NOW)))
          .join();
      assertThat(store.search("Alice", "", 100).join())
          .contains("credential redacted")
          .doesNotContain(credential);
    }
  }

  @Test
  void credentialShapesInDisplayNamesAndMetadataNeverReachEvidenceOrTheProvider() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var calls = new AtomicInteger();
      var service =
          new SafetyService(
              store,
              (submission, text, context) -> {
                calls.incrementAndGet();
                return CompletableFuture.completedFuture(allow());
              },
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));
      var credential = "sk-proj-" + "a".repeat(24);
      var request =
          new ContentSubmission(
              UUID.randomUUID(),
              ALICE,
              credential,
              "discord",
              "channel:" + credential,
              "hello",
              credential,
              credential);
      var review = service.check(request).join();
      assertThat(review.allowed()).isFalse();
      assertThat(review.muteSeconds()).isZero();
      assertThat(calls.get()).isZero();
      assertThat(store.search("", "", 100).join())
          .contains("credential redacted")
          .doesNotContain(credential);
    }
  }

  @Test
  void punishmentReceiptWaitsForTheMainThreadOwnerToFinish() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var pending = new CompletableFuture<Void>();
      var reached = new CompletableFuture<Void>();
      var service =
          new SafetyService(
              store,
              (submission, text, context) -> CompletableFuture.completedFuture(allow()),
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));
      service.penalties(request -> {
        reached.complete(null);
        return pending;
      });
      var result = service.check(submission("n" + "igger"));
      reached.join();
      assertThat(result).isNotDone();
      assertThat(store.strikes(ALICE, "penalty", NOW.minusSeconds(1)).join()).isZero();
      pending.complete(null);
      assertThat(result.join().muteSeconds()).isEqualTo(600);
      assertThat(store.strikes(ALICE, "penalty", NOW.minusSeconds(1)).join()).isEqualTo(1);
    }
  }

  @Test
  void attemptsAreDurableBeforeTheClassifierFinishes() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var waiting = new CompletableFuture<ContentReview>();
      var reached = new CompletableFuture<Void>();
      var service =
          new SafetyService(
              store,
              (submission, text, context) -> {
                reached.complete(null);
                return waiting;
              },
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));
      var request = submission("an ordinary message");
      var result = service.check(request);
      reached.join();
      var queued = submission("queued message is already durable");
      var queuedResult = service.check(queued);
      assertThat(result).isNotDone();
      assertThat(store.search("Alice", "ordinary", 100).join()).contains(request.id().toString());
      assertThat(store.search("Alice", "queued", 100).join()).contains(queued.id().toString());
      waiting.complete(allow());
      assertThat(result.join().allowed()).isTrue();
      assertThat(queuedResult.join().allowed()).isTrue();
      service.finish(request.id(), "delivered").join();
    }
  }

  @Test
  void failuresRemainUnpublishedAndDoNotCreateStrikes() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var service =
          new SafetyService(
              store,
              (submission, text, context) ->
                  CompletableFuture.failedFuture(new IllegalStateException("provider down")),
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));
      assertThatThrownBy(() -> service.check(submission("hello")).join())
          .hasMessageContaining("temporarily unavailable");
      assertThat(store.strikes(ALICE, "penalty", NOW.minusSeconds(1)).join()).isZero();
      assertThat(store.search("Alice", "hello", 100).join()).contains("hello");
    }
  }

  @Test
  void explicitAbuseGetsShortMutesButModelOnlyThreatsDoNot() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var penalties = new AtomicInteger();
      var service =
          new SafetyService(
              store,
              (submission, text, context) ->
                  CompletableFuture.completedFuture(
                      new ContentReview(
                          "block",
                          "threat",
                          .99,
                          "Targeted threat.",
                          "fixture",
                          0,
                          0,
                          java.util.Map.of(),
                          true)),
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));
      service.penalties(request -> {
        penalties.incrementAndGet();
        return CompletableFuture.completedFuture(null);
      });
      assertThat(service.check(submission("n" + "igger")).join().muteSeconds()).isEqualTo(600);
      assertThat(service.check(submission("n" + "igger")).join().muteSeconds()).isEqualTo(3600);
      assertThat(service.check(submission("a threat")).join().muteSeconds()).isZero();
      assertThat(penalties.get()).isEqualTo(2);
    }
  }

  @Test
  void firstColdAdvertisementIsBlockedAndOnlyAConfirmedRepeatGetsMuted() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var service =
          new SafetyService(
              store,
              (submission, text, context) ->
                  CompletableFuture.completedFuture(
                      new ContentReview(
                          "block",
                          "advertising",
                          .99,
                          "Cold public promotion.",
                          "fixture",
                          0,
                          0,
                          java.util.Map.of(),
                          true)),
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));
      var first = submission("cold promotion one");
      service.penalties(request -> CompletableFuture.completedFuture(null));
      assertThat(service.check(first).join().muteSeconds()).isZero();
      assertThat(service.check(submission("cold promotion two")).join().muteSeconds()).isZero();
      service.finish(first.id(), "advertising-warned").join();
      assertThat(service.check(submission("cold promotion three")).join().muteSeconds())
          .isEqualTo(600);
    }
  }

  @Test
  void disabledRolloutStillArchivesAndDoesNotCallTheProvider() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var service =
          new SafetyService(
              store,
              (submission, text, context) -> {
                throw new AssertionError("Disabled screen called provider");
              },
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(false)));
      var review = service.check(submission("hello")).join();
      assertThat(review.allowed()).isTrue();
      assertThat(review.screened()).isFalse();
      assertThat(store.search("Alice", "hello", 100).join()).contains("hello");
    }
  }

  @Test
  void failedReviewPersistenceDoesNotInventAnAppliedPenalty() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var service =
          new SafetyService(
              store,
              (submission, text, context) -> CompletableFuture.completedFuture(allow()),
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));
      var applied = new AtomicInteger();
      service.penalties(request -> {
        applied.incrementAndGet();
        return CompletableFuture.completedFuture(null);
      });
      service.reviews((submission, review) ->
          CompletableFuture.failedFuture(new IllegalStateException("review storage down")));
      assertThatThrownBy(() -> service.check(submission("n" + "igger")).join())
          .hasMessageContaining("temporarily unavailable");
      assertThat(applied.get()).isZero();
      assertThat(store.strikes(ALICE, "penalty", NOW.minusSeconds(1)).join()).isZero();
    }
  }

  @Test
  void stageOneInstantBlocksPersistEvidenceAndPenaltiesWithoutCallingClassifier() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var classifierCalls = new AtomicInteger();
      var penalties = new AtomicInteger();
      var now = new java.util.concurrent.atomic.AtomicReference<>(NOW);
      var service =
          new SafetyService(
              store,
              (submission, text, context) -> {
                classifierCalls.incrementAndGet();
                return CompletableFuture.completedFuture(allow());
              },
              new SafetyService.Policy(
                  now::get, CONFIG, player -> CompletableFuture.completedFuture(true)));
      service.penalties(request -> {
        penalties.incrementAndGet();
        return CompletableFuture.completedFuture(null);
      });

      var slurSubmission = submission("kys right now");
      var slurBlock = service.instantBlock(slurSubmission).orElseThrow();
      var review = service.recordInstantBlock(slurSubmission, slurBlock).join();
      assertThat(review.allowed()).isFalse();
      assertThat(review.muteSeconds()).isEqualTo(600);
      assertThat(penalties.get()).isEqualTo(1);
      assertThat(classifierCalls.get()).isZero();

      var credential = "sk-proj-" + "z".repeat(28);
      var secretSubmission = submission("token " + credential);
      var secretBlock = service.instantBlock(secretSubmission).orElseThrow();
      var secretReview = service.recordInstantBlock(secretSubmission, secretBlock).join();
      assertThat(secretReview.muteSeconds()).isZero();
      assertThat(penalties.get()).isEqualTo(1);
      assertThat(store.search("Alice", "", 100).join()).doesNotContain(credential);
      assertThat(store.recover(NOW.plusSeconds(5)).join()).isZero();

      for (var i = 0; i < 24; i++) {
        service.recordRecentWindow(submission("line " + i));
      }
      assertThat(service.instantBlock(submission("twenty fifth"))).isPresent();
      now.set(NOW.plusSeconds(21));
      assertThat(service.instantBlock(submission("after window expiry"))).isEmpty();
    }
  }

  @Test
  void optimisticDeliveriesFeedConversationContextUnlessRetroactivelyDeleted() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var seenContext = new java.util.concurrent.atomic.AtomicReference<>("");
      var service =
          new SafetyService(
              store,
              (submission, text, context) -> {
                seenContext.set(context);
                return CompletableFuture.completedFuture(allow());
              },
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));

      var kept = submission("kept context message");
      service.checkDelivered(kept).join();
      service.finish(kept.id(), "delivered-optimistic").join();

      var retracted = submission("removed context message");
      service.checkDelivered(retracted).join();
      service.finish(retracted.id(), "delivered-optimistic").join();
      service.finish(retracted.id(), "deleted-retroactively").join();

      service.checkDelivered(submission("follow-up")).join();
      assertThat(seenContext.get())
          .contains("kept context message")
          .doesNotContain("removed context message");
    }
  }

  @Test
  void concurrentBurstSubmissionsDoNotCountSubsequentQueuedLinksAgainstEarlierMessages() {
    try (var db = database()) {
      var store = new JooqEvidenceStore(db);
      var penalties = new AtomicInteger();
      var gate = new CompletableFuture<ContentReview>();
      var service =
          new SafetyService(
              store,
              (submission, text, context) -> gate,
              new SafetyService.Policy(
                  InstantSource.fixed(NOW),
                  CONFIG,
                  player -> CompletableFuture.completedFuture(true)));
      service.penalties(request -> {
        penalties.incrementAndGet();
        return CompletableFuture.completedFuture(null);
      });

      var first = submission("https://example.com");
      var second = submission("https://example.com");
      var third = submission("https://example.com");

      service.recordRecentWindow(first);
      var firstCheck = service.checkDelivered(first);
      service.recordRecentWindow(second);
      var secondCheck = service.checkDelivered(second);
      var thirdBlock = service.instantBlock(third).orElseThrow();
      var thirdRecord = service.recordInstantBlock(third, thirdBlock);

      gate.complete(allow());
      assertThat(firstCheck.join().allowed()).isTrue();
      assertThat(secondCheck.join().allowed()).isTrue();
      assertThat(thirdRecord.join().allowed()).isFalse();
      assertThat(penalties.get()).isEqualTo(1);
    }
  }
}
