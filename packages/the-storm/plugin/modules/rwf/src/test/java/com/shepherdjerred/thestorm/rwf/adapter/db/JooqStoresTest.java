package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.snapshot.EffectRecord;
import com.shepherdjerred.thestorm.core.snapshot.Experience;
import com.shepherdjerred.thestorm.core.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.snapshot.Position;
import com.shepherdjerred.thestorm.core.snapshot.Snapshot;
import com.shepherdjerred.thestorm.core.snapshot.Vitals;
import com.shepherdjerred.thestorm.rwf.app.RecordingSummary;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.Outcome;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.PayoutStatus;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.PlayerRow;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletionException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The repositories against a real, temporary SQLite database. */
final class JooqStoresTest {

  private static final UUID ALICE = Samples.ALICE.uuid();
  private static final UUID BOB = Samples.BOB.uuid();
  private static final LocalDate DAY = LocalDate.of(2026, 10, 3);

  @TempDir Path directory;
  private StormDatabase database;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("rwf", getClass().getClassLoader());
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static Snapshot snapshot(UUID player, List<EffectRecord> effects) {
    return new Snapshot(
        player,
        "rwf",
        new Position("world", 12.5, 64, -3.25, 90.5f, -10f),
        new Vitals(13.5, 17, 3.5f, 1.25f, "ADVENTURE"),
        new Experience(30, 0.5f, 1395),
        ItemData.of(new byte[] {10, 20, 30, 40}),
        effects,
        T0);
  }

  private static MatchStore.MatchRow match(UUID id) {
    return new MatchStore.MatchRow(
        id, "training-yard", T0, T0.plusSeconds(300), Optional.of(TeamColor.RED), 2, 6);
  }

  private static PlayerRow row(UUID match, UUID player, Outcome outcome, long owed) {
    return new PlayerRow(
        match,
        player,
        TeamColor.RED,
        "trooper",
        1,
        0,
        outcome,
        owed,
        owed > 0 ? PayoutStatus.PENDING : PayoutStatus.NONE,
        0);
  }

  @Test
  void snapshotsRoundTripAndRetireLikeTheArenas() {
    var store = new JooqSnapshotStore(database);
    var alice =
        snapshot(ALICE, List.of(new EffectRecord("minecraft:speed", 1, 600, false, true, true)));
    store.save(alice).join();
    store.save(snapshot(BOB, List.of())).join();

    assertThat(store.loadAll().join()).contains(alice).hasSize(2);
    assertThat(store.markRestored(ALICE, T0).join()).isTrue();
    assertThat(store.markRestored(ALICE, T0).join()).isFalse();
    assertThat(store.loadAll().join()).extracting(Snapshot::player).containsExactly(BOB);
    store.deleteRestored(ALICE).join();
    store.deleteRestored(BOB).join();
    assertThat(store.loadAll().join()).extracting(Snapshot::player).containsExactly(BOB);
  }

  @Test
  void aMatchAndItsPlayersAreWrittenTogetherAndTheOutboxListsTheUnpaid() {
    var store = new JooqMatchStore(database);
    var id = UUID.randomUUID();

    store
        .record(match(id), List.of(row(id, ALICE, Outcome.WIN, 3), row(id, BOB, Outcome.LOSE, 0)))
        .join();

    assertThat(store.unpaid().join())
        .singleElement()
        .satisfies(
            row -> {
              assertThat(row.player()).isEqualTo(ALICE);
              assertThat(row.status()).isEqualTo(PayoutStatus.PENDING);
            });
    assertThat(store.players(id).join()).hasSize(2);
  }

  @Test
  void aPlayerFromAnotherMatchIsRefused() {
    var store = new JooqMatchStore(database);
    var id = UUID.randomUUID();

    assertThatThrownBy(
            () -> store.record(match(id), List.of(row(UUID.randomUUID(), ALICE, Outcome.WIN, 3))))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void beginningAPayoutAppliesTheDailyCapOnceAndIsIdempotent() {
    var store = new JooqMatchStore(database);
    var first = UUID.randomUUID();
    var second = UUID.randomUUID();
    store.record(match(first), List.of(row(first, ALICE, Outcome.WIN, 3))).join();
    store.record(match(second), List.of(row(second, ALICE, Outcome.WIN, 3))).join();

    assertThat(store.beginPayout(first, ALICE, DAY, 4).join()).isEqualTo(3);
    assertThat(store.beginPayout(first, ALICE, DAY, 4).join()).as("repeat").isEqualTo(3);
    assertThat(store.beginPayout(second, ALICE, DAY, 4).join()).as("capped").isEqualTo(1);
    store.finishPayout(first, ALICE).join();
    store.finishPayout(second, ALICE).join();

    assertThat(store.unpaid().join()).isEmpty();
    assertThat(store.beginPayout(first, ALICE, DAY, 4).join()).as("paid rows pay nothing").isZero();
    assertThat(store.players(second).join())
        .singleElement()
        .satisfies(
            row -> {
              assertThat(row.creditsOwed()).isEqualTo(3);
              assertThat(row.creditsPaid()).isEqualTo(1);
              assertThat(row.status()).isEqualTo(PayoutStatus.PAID);
            });
  }

  @Test
  void aNewDayStartsTheCapAgain() {
    var store = new JooqMatchStore(database);
    var first = UUID.randomUUID();
    var second = UUID.randomUUID();
    store.record(match(first), List.of(row(first, ALICE, Outcome.WIN, 3))).join();
    store.record(match(second), List.of(row(second, ALICE, Outcome.WIN, 3))).join();

    assertThat(store.beginPayout(first, ALICE, DAY, 3).join()).isEqualTo(3);
    assertThat(store.beginPayout(second, ALICE, DAY.plusDays(1), 3).join()).isEqualTo(3);
  }

  @Test
  void finishingARowThatIsNotPayingFailsLoudly() {
    var store = new JooqMatchStore(database);
    var id = UUID.randomUUID();
    store.record(match(id), List.of(row(id, ALICE, Outcome.WIN, 3))).join();

    assertThatThrownBy(() -> store.finishPayout(id, ALICE).join())
        .isInstanceOf(CompletionException.class)
        .hasCauseInstanceOf(IllegalStateException.class);
  }

  @Test
  void theRecordingSummaryIsAttachedAfterwards() {
    var store = new JooqMatchStore(database);
    var id = UUID.randomUUID();
    store.record(match(id), List.of()).join();

    store
        .recordingFinished(
            id, new RecordingSummary(Optional.of("rwf-recordings/2026/10/03/x.rwfrec.gz"), 1234, 2))
        .join();

    var row =
        database
            .read(
                dsl ->
                    dsl.selectFrom(
                            com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH)
                        .fetchOptional()
                        .orElseThrow())
            .join();
    assertThat(row.getRecordingFile()).isEqualTo("rwf-recordings/2026/10/03/x.rwfrec.gz");
    assertThat(row.getRecordingBytes()).isEqualTo(1234);
    assertThat(row.getDroppedFrames()).isEqualTo(2);
  }
}
