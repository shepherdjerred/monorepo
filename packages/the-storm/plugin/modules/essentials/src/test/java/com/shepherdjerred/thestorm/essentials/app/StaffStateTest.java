package com.shepherdjerred.thestorm.essentials.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqStaffStore;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Runtime places and moderation survive restart; a failed audit never changes cached state. */
final class StaffStateTest {
  @TempDir Path directory;

  @Test
  void committedSpawnAndJailSurviveRestart() {
    var point = new Position("world", 10, 70, 10, 0, 0);
    var id = UUID.randomUUID().toString();
    var jail =
        new StaffState.Jail(
            "cell",
            point,
            new Position("world", 0, 64, 0, 0, 0),
            Instant.parse("2026-10-04T12:00:00Z"),
            true);
    try (var db = StormDatabase.open(directory.resolve("staff.db"))) {
      db.migrate("essentials", getClass().getClassLoader());
      var state = new StaffState(new JooqStaffStore(db));
      state.loaded().join();
      state
          .commit(
              List.of(state.entry("spawn", "default", point), state.entry("jail", id, jail)),
              new StaffStore.Audit("staff", "jail", id, Instant.EPOCH))
          .join();
    }
    try (var db = StormDatabase.open(directory.resolve("staff.db"))) {
      db.migrate("essentials", getClass().getClassLoader());
      var state = new StaffState(new JooqStaffStore(db));
      state.loaded().join();
      assertThat(state.find("jail", id, StaffState.Jail.class)).contains(jail);
      assertThat(new RuntimeDestinations(state, new Position("world", 0, 60, 0, 0, 0)).spawn())
          .isEqualTo(point);
      assertThat(
              db.read(
                      sql ->
                          sql.fetchCount(
                              com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables
                                  .ESSENTIALS_STAFF_AUDIT))
                  .join())
          .isEqualTo(1);
    }
  }

  @Test
  void failedWriteDoesNotPublishState() {
    var state =
        new StaffState(
            new StaffStore() {
              @Override
              public CompletableFuture<List<Entry>> load() {
                return CompletableFuture.completedFuture(List.of());
              }

              @Override
              public CompletableFuture<Void> write(List<Entry> entries, Audit audit) {
                return CompletableFuture.failedFuture(new IllegalStateException("disk full"));
              }
            });
    assertThatThrownBy(
            () ->
                state
                    .commit(
                        List.of(state.entry("jail-deleted", "cell", true)),
                        new StaffStore.Audit("staff", "deljail", "cell", Instant.EPOCH))
                    .join())
        .hasRootCauseMessage("disk full");
    assertThat(state.find("jail-deleted", "cell", Boolean.class)).isEmpty();
  }

  @Test
  void elapsedSentencesAreInactiveEvenBeforeTheReleaseSweepPersistsThem() {
    var expires = Instant.parse("2026-10-04T12:00:00Z");
    var active =
        new StaffState.Jail(
            "cell",
            new Position("world", 1, 64, 1, 0, 0),
            new Position("world", 0, 64, 0, 0, 0),
            expires,
            true);
    var released =
        new StaffState.Jail("cell", active.destination(), active.returning(), expires, false);

    assertThat(active.activeAt(expires.minusMillis(1))).isTrue();
    assertThat(active.activeAt(expires)).isFalse();
    assertThat(released.activeAt(expires.minusMillis(1))).isFalse();
  }
}
