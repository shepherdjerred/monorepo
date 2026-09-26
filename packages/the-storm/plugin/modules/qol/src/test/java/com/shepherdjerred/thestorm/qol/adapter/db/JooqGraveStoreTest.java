package com.shepherdjerred.thestorm.qol.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import com.shepherdjerred.thestorm.qol.domain.grave.ItemBytes;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletionException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqGraveStoreTest {

  static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");

  @TempDir Path directory;
  StormDatabase database;
  JooqGraveStore store;

  @BeforeEach
  void open() {
    database = openDatabase();
    store = new JooqGraveStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  StormDatabase openDatabase() {
    var opened = StormDatabase.open(directory.resolve("t.db"));
    opened.migrate("qol", JooqGraveStoreTest.class.getClassLoader());
    return opened;
  }

  /** Closes the database as a crash would leave it and opens it again. */
  void restart() {
    database.close();
    database = openDatabase();
    store = new JooqGraveStore(database);
  }

  static ItemBytes item(int b) {
    return ItemBytes.of(new byte[] {(byte) b, (byte) (b + 1), 42});
  }

  static GraveItem stack(int index, int slot) {
    return new GraveItem(index, slot < 0 ? OptionalInt.empty() : OptionalInt.of(slot), item(index));
  }

  static GraveContents grave(int id, UUID owner, int x, List<GraveItem> items) {
    return new GraveContents(
        new Grave(
            new UUID(0, id),
            owner,
            "Owner" + id,
            new GravePos("world", x, 64, -5),
            T0.plusSeconds(id),
            id % 2 == 0 ? "minecraft:cave_air" : "minecraft:air"),
        items);
  }

  static final GraveContents ALICES =
      grave(1, ALICE, 10, List.of(stack(0, 39), stack(1, 0), stack(2, -1), stack(3, 40)));

  @Test
  void migratingTwiceIsHarmless() {
    database.migrate("qol", JooqGraveStoreTest.class.getClassLoader());
  }

  @Test
  void aSavedGraveSurvivesARestartExactly() {
    var bobs = grave(2, BOB, 20, List.of(stack(0, 5)));
    store.create(ALICES).join();
    store.create(bobs).join();

    restart();

    assertThat(store.loadAll().join()).containsExactly(ALICES, bobs);
  }

  @Test
  void takingRemovesExactlyTheRequestedStacksThatAreStillThere() {
    store.create(ALICES).join();

    var taken = store.take(new UUID(0, 1), Set.of(1, 3, 99)).join();

    assertThat(taken.items()).containsExactly(stack(1, 0), stack(3, 40));
    assertThat(taken.remaining()).isEqualTo(2);
    restart();
    assertThat(store.loadAll().join()).containsExactly(ALICES.without(Set.of(1, 3)));
  }

  @Test
  void aStackCanBeTakenOnlyOnce() {
    store.create(ALICES).join();
    var id = new UUID(0, 1);

    var first = store.take(id, Set.of(0, 1));
    var second = store.take(id, Set.of(0, 1));

    var got = List.of(first.join(), second.join());
    assertThat(got).filteredOn(taken -> !taken.items().isEmpty()).hasSize(1);
    assertThat(got.get(0).items().size() + got.get(1).items().size()).isEqualTo(2);
  }

  @Test
  void anEmptiedGraveStaysUntilDeletedSoStacksCanBePutBack() {
    store.create(ALICES).join();
    var id = new UUID(0, 1);

    var taken = store.take(id, Set.of(0, 1, 2, 3)).join();
    assertThat(taken.remaining()).isZero();
    assertThat(store.loadAll().join())
        .singleElement()
        .satisfies(c -> assertThat(c.isEmpty()).isTrue());

    store.putBack(id, taken.items()).join();
    assertThat(store.loadAll().join()).containsExactly(ALICES);
  }

  @Test
  void deletingReturnsWhatWasLeftAndRemovesTheGrave() {
    store.create(ALICES).join();
    store.take(new UUID(0, 1), Set.of(0)).join();

    var left = store.delete(new UUID(0, 1)).join();

    assertThat(left).containsExactly(stack(1, 0), stack(2, -1), stack(3, 40));
    assertThat(store.loadAll().join()).isEmpty();
    assertThat(store.delete(new UUID(0, 1)).join()).isEmpty();
  }

  @Test
  void aFailedCreateSavesNothing() {
    store.create(ALICES).join();
    var samePlace = grave(2, BOB, 10, List.of(stack(0, 1)));

    assertThatThrownBy(() -> store.create(samePlace).join())
        .isInstanceOf(CompletionException.class);

    restart();
    assertThat(store.loadAll().join()).containsExactly(ALICES);
  }

  @Test
  void aGraveWithoutStacksCanBeSaved() {
    var empty = grave(3, BOB, 30, List.of());
    store.create(empty).join();
    assertThat(store.loadAll().join()).containsExactly(empty);
  }

  @Test
  void expiringRemovesTheGraveAndLeavesANoticeInOneTransaction() {
    store.create(ALICES).join();
    var notice = new GraveStore.Notice(ALICE, "Your grave broke open.", T0);

    var left = store.expire(new UUID(0, 1), Optional.of(notice)).join();

    assertThat(left).hasSize(4);
    assertThat(store.loadAll().join()).isEmpty();
    restart();
    assertThat(store.takeNotices(BOB).join()).isEmpty();
    assertThat(store.takeNotices(ALICE).join()).containsExactly("Your grave broke open.");
    assertThat(store.takeNotices(ALICE).join()).isEmpty();
  }

  @Test
  void expiringWithoutANoticeLeavesNone() {
    store.create(ALICES).join();

    store.expire(new UUID(0, 1), Optional.empty()).join();

    assertThat(store.takeNotices(ALICE).join()).isEmpty();
  }

  @Test
  void noticesComeBackOldestFirst() {
    store.create(ALICES).join();
    store.create(grave(3, ALICE, 30, List.of(stack(0, 1)))).join();
    store.expire(new UUID(0, 1), Optional.of(new GraveStore.Notice(ALICE, "first", T0))).join();
    store.expire(new UUID(0, 3), Optional.of(new GraveStore.Notice(ALICE, "second", T0))).join();

    assertThat(store.takeNotices(ALICE).join()).containsExactly("first", "second");
  }

  @Test
  void theReplacedBlockIsKept() {
    var bobs = grave(2, BOB, 20, List.of(stack(0, 5)));
    store.create(bobs).join();
    restart();
    assertThat(store.loadAll().join())
        .singleElement()
        .satisfies(c -> assertThat(c.grave().replaced()).isEqualTo("minecraft:cave_air"));
  }
}
