package com.shepherdjerred.thestorm.safety.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import com.shepherdjerred.thestorm.safety.app.EvidenceQuery;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.InstantSource;
import java.util.UUID;
import java.util.random.RandomGeneratorFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

final class EvidenceQueriesTest {
  @TempDir Path directory;
  private static final Instant NOW = Instant.parse("2026-10-16T13:00:00Z");
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final UUID PLAYER = new UUID(1, 2);

  private StormDatabase open(Path file) {
    var database = StormDatabase.open(file);
    database.migrate("safety", getClass().getClassLoader());
    return database;
  }

  private static ContentSubmission submission(int index) {
    return new ContentSubmission(
        new UUID(2, index),
        PLAYER,
        "Alice",
        "message",
        "dm:private",
        "private body " + index,
        "{components}",
        "recipient");
  }

  private static String request(String action, long after, String until) {
    return JSON.writeValueAsString(
        new EvidenceQuery(
            action,
            "Alice",
            "private body",
            "message",
            "1970-01-01T00:00:00Z",
            until,
            after,
            2,
            ""));
  }

  private static EvidenceQueries queries(StormDatabase database) {
    return new EvidenceQueries(
        database,
        new JooqEvidenceStore(database),
        InstantSource.fixed(NOW),
        RandomGeneratorFactory.of("L64X128MixRandom").create(1));
  }

  @Test
  void overturnsRemainVisibleButStopCountingTowardEscalation() {
    try (var database = open(directory.resolve("evidence.db"))) {
      var store = new JooqEvidenceStore(database);
      var request = submission(1);
      store.attempt(request, NOW).join();
      store.event(request.id(), "penalty", "spam", NOW).join();
      store.event(request.id(), "advertising-warned", "", NOW).join();
      assertThat(store.strikes(PLAYER, "penalty", NOW.minusSeconds(1)).join()).isEqualTo(1);
      store.event(request.id(), "overturned", "Reviewer", NOW.plusMillis(1)).join();
      assertThat(store.strikes(PLAYER, "penalty", NOW.minusSeconds(1)).join()).isZero();
      assertThat(store.advertisingWarnings(PLAYER, NOW.minusSeconds(1), NOW.plusSeconds(1)).join())
          .isZero();
      var page =
          queries(database).query(request("search", 0, NOW.plusSeconds(1).toString()), "operator");
      assertThat(page.join()).contains("overturned", "penalty", "advertising-warned");
    }
  }

  @Test
  void pagesIncludeEventsAndExcludeNewerSubmissionsAndAccessAudit() {
    try (var database = open(directory.resolve("evidence.db"))) {
      var store = new JooqEvidenceStore(database);
      for (var index = 1; index <= 4; index++) {
        var submission = submission(index);
        store.attempt(submission, NOW.plusMillis(index)).join();
        store.event(submission.id(), "delivered", "", NOW.plusMillis(index)).join();
      }
      var access = queries(database);
      var until = NOW.plusMillis(3).toString();
      var first = JSON.readTree(access.query(request("export", 0, until), "operator").join());
      assertThat(first.required("rows").size()).isEqualTo(2);
      assertThat(first.required("events").size()).isEqualTo(2);
      assertThat(first.required("hasMore").asBoolean()).isTrue();
      var second =
          JSON.readTree(
              access
                  .query(request("export", first.required("next").asLong(), until), "operator")
                  .join());
      assertThat(second.required("rows").size()).isEqualTo(1);
      assertThat(second.required("hasMore").asBoolean()).isFalse();
      assertThat(second.toString())
          .contains("private body 3")
          .doesNotContain("private body 4", "evidence-access");
      assertThat(store.search("operator", "", 100).join()).contains("evidence-access");
    }
  }

  @Test
  void malformedQueriesDoNotExposePrivateInputInDiagnostics() {
    try (var database = open(directory.resolve("evidence.db"))) {
      var access = queries(database);
      assertThatThrownBy(() -> access.query("{\"private-body\":\"sensitive\"}", "operator"))
          .hasMessage("Invalid evidence query")
          .hasNoCause();
    }
  }

  @Test
  void warningsOnlyCountWhenTheyPrecedeTheNewAttempt() {
    try (var database = open(directory.resolve("evidence.db"))) {
      var store = new JooqEvidenceStore(database);
      store.attempt(submission(1), NOW).join();
      store.event(submission(1).id(), "advertising-warned", "", NOW.plusSeconds(2)).join();
      assertThat(store.advertisingWarnings(PLAYER, NOW, NOW.plusSeconds(1)).join()).isZero();
      assertThat(store.advertisingWarnings(PLAYER, NOW, NOW.plusSeconds(3)).join()).isEqualTo(1);
    }
  }

  @Test
  void evidenceSurvivesAStoppedDatabaseCopyAndRecoveryIsIdempotent() throws java.io.IOException {
    var file = directory.resolve("evidence.db");
    try (var database = open(file)) {
      var store = new JooqEvidenceStore(database);
      store.attempt(submission(1), NOW).join();
      store.event(submission(1).id(), "decision", "allowed", NOW).join();
      store.attempt(submission(2), NOW).join();
      store.event(submission(2).id(), "delivered", "", NOW).join();
    }
    var restored = Files.copy(file, directory.resolve("restored.db"));
    try (var database = open(restored)) {
      var store = new JooqEvidenceStore(database);
      assertThat(store.recover(NOW).join()).isEqualTo(1);
      assertThat(store.recover(NOW).join()).isZero();
      var page = queries(database).query(request("search", 0, NOW.toString()), "operator").join();
      assertThat(page).contains("private body 1", "private body 2", "interrupted", "delivered");
    }
  }
}
