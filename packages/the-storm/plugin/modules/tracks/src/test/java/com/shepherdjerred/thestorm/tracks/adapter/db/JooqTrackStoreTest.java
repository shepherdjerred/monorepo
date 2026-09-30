package com.shepherdjerred.thestorm.tracks.adapter.db;

import static com.shepherdjerred.thestorm.tracks.adapter.db.generated.Tables.TRACKS_LEVEL;
import static com.shepherdjerred.thestorm.tracks.adapter.db.generated.Tables.TRACKS_PLAYER;
import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.GOVERNOR;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.boughtAt;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.domain.AdminChanges;
import com.shepherdjerred.thestorm.tracks.domain.AdminProblem;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqTrackStoreTest {

  private static final UUID ALICE = new UUID(0, 1);
  private static final UUID BOB = new UUID(0, 2);

  @TempDir Path directory;

  private StormDatabase database;
  private JooqTrackStore store;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("tracks", JooqTrackStoreTest.class.getClassLoader());
    store = new JooqTrackStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }

  private Result<TrackProgress, AdminProblem> replace(UUID player, TrackProgress progress)
      throws Exception {
    return await(store.update(player, current -> Result.ok(progress)));
  }

  @Test
  void aPlayerWhoNeverTrainedLoadsEmpty() throws Exception {
    assertThat(await(store.load(ALICE))).isEqualTo(TrackProgress.empty());
  }

  @Test
  void progressRoundTripsWithOrderLevelsAndCooldown() throws Exception {
    var progress = boughtAt(owning(GOVERNOR, 4, MECHANIC, 1, ENGINEER, 3), NOW);

    replace(ALICE, progress);

    assertThat(await(store.load(ALICE))).isEqualTo(progress);
  }

  @Test
  void progressWithoutAPurchaseKeepsNoCooldown() throws Exception {
    replace(ALICE, owning(MECHANIC, 2));

    assertThat(await(store.load(ALICE)).lastPurchase()).isEmpty();
  }

  @Test
  void theCooldownTimeKeepsMilliseconds() throws Exception {
    var at = NOW.plusMillis(123);
    replace(ALICE, boughtAt(owning(MECHANIC, 2), at));

    assertThat(await(store.load(ALICE)).lastPurchase()).contains(at);
  }

  @Test
  void anUpdateReturnsExactlyWhatALaterLoadSees() throws Exception {
    var result = replace(ALICE, boughtAt(owning(MECHANIC, 2), NOW.plusNanos(123_456_789)));

    var stored = await(store.load(ALICE));
    assertThat(result).isEqualTo(Result.ok(stored));
    assertThat(stored.lastPurchase()).contains(NOW.plusMillis(123));
  }

  @Test
  void updatesSeeTheStoredProgressAndReturnWhatTheyStored() throws Exception {
    replace(ALICE, owning(MECHANIC, 3));

    var result = await(store.update(ALICE, current -> AdminChanges.set(current, ENGINEER, 2)));

    assertThat(result).isEqualTo(Result.ok(owning(MECHANIC, 3, ENGINEER, 2)));
    assertThat(await(store.load(ALICE))).isEqualTo(owning(MECHANIC, 3, ENGINEER, 2));
  }

  @Test
  void aRefusedUpdateWritesNothing() throws Exception {
    replace(ALICE, owning(MECHANIC, 1));

    var result = await(store.update(ALICE, current -> AdminChanges.set(current, ENGINEER, 2)));

    assertThat(result)
        .isEqualTo(Result.err(new AdminProblem.AbovePrimary(ENGINEER, 2, MECHANIC, 1)));
    assertThat(await(store.load(ALICE))).isEqualTo(owning(MECHANIC, 1));
  }

  @Test
  void aChangeThatThrowsRollsBack() throws Exception {
    replace(ALICE, owning(MECHANIC, 1));

    var failing =
        store.update(
            ALICE,
            current -> {
              throw new IllegalStateException("boom");
            });

    assertThatThrownBy(() -> await(failing)).isInstanceOf(ExecutionException.class);
    assertThat(await(store.load(ALICE))).isEqualTo(owning(MECHANIC, 1));
  }

  @Test
  void removingATrackRenumbersTheOrder() throws Exception {
    replace(ALICE, owning(MECHANIC, 3, ENGINEER, 1, GOVERNOR, 2));

    await(store.update(ALICE, current -> AdminChanges.set(current, ENGINEER, 0)));

    assertThat(await(store.load(ALICE))).isEqualTo(owning(MECHANIC, 3, GOVERNOR, 2));
    var positions =
        await(
            database.read(
                dsl ->
                    dsl.select(TRACKS_LEVEL.POSITION)
                        .from(TRACKS_LEVEL)
                        .where(TRACKS_LEVEL.PLAYER_ID.eq(ALICE.toString()))
                        .orderBy(TRACKS_LEVEL.POSITION)
                        .fetch(TRACKS_LEVEL.POSITION)));
    assertThat(positions).containsExactly(0, 1);
  }

  @Test
  void aResetDeletesThePlayersRows() throws Exception {
    replace(ALICE, boughtAt(owning(MECHANIC, 3, ENGINEER, 1), NOW));

    replace(ALICE, AdminChanges.reset());

    assertThat(await(store.load(ALICE))).isEqualTo(TrackProgress.empty());
    var rows =
        await(database.read(dsl -> dsl.fetchCount(TRACKS_PLAYER) + dsl.fetchCount(TRACKS_LEVEL)));
    assertThat(rows).isZero();
  }

  @Test
  void playersAreKeptApart() throws Exception {
    replace(ALICE, owning(MECHANIC, 3));
    replace(BOB, owning(ENGINEER, 1));

    replace(ALICE, AdminChanges.reset());

    assertThat(await(store.load(BOB))).isEqualTo(owning(ENGINEER, 1));
  }

  @Test
  void concurrentUpdatesNeverLoseALevel() throws Exception {
    var futures = new ArrayList<CompletableFuture<Result<TrackProgress, AdminProblem>>>();
    IntStream.range(0, 5)
        .forEach(
            ignored ->
                futures.add(
                    store.update(
                        ALICE,
                        current ->
                            AdminChanges.set(current, MECHANIC, current.level(MECHANIC) + 1))));
    for (var future : futures) {
      assertThat(await(future).isOk()).isTrue();
    }

    assertThat(await(store.load(ALICE)).level(MECHANIC)).isEqualTo(5);
  }

  @Test
  void theSchemaRejectsUnknownTracksAndLevels() throws Exception {
    replace(ALICE, owning(MECHANIC, 1));
    var id = ALICE.toString();

    var badTrack =
        database.write(
            dsl ->
                dsl.insertInto(TRACKS_LEVEL)
                    .set(TRACKS_LEVEL.PLAYER_ID, id)
                    .set(TRACKS_LEVEL.TRACK, "wizard")
                    .set(TRACKS_LEVEL.LEVEL, 1)
                    .set(TRACKS_LEVEL.POSITION, 1)
                    .execute());
    var badLevel =
        database.write(
            dsl ->
                dsl.insertInto(TRACKS_LEVEL)
                    .set(TRACKS_LEVEL.PLAYER_ID, id)
                    .set(TRACKS_LEVEL.TRACK, "engineer")
                    .set(TRACKS_LEVEL.LEVEL, 6)
                    .set(TRACKS_LEVEL.POSITION, 1)
                    .execute());

    assertThatThrownBy(() -> await(badTrack)).isInstanceOf(ExecutionException.class);
    assertThatThrownBy(() -> await(badLevel)).isInstanceOf(ExecutionException.class);
  }
}
