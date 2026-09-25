package com.shepherdjerred.thestorm.arena.domain.snapshot;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.arena.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class SnapshotBookTest {

  static Snapshot snapshot(UUID player, String arena) {
    return new Snapshot(
        player,
        arena,
        new Position("world", 1.5, 64, -2.5, 90, 10),
        new Vitals(17.5, 18, 2.5f, 0.5f, "SURVIVAL"),
        new Experience(12, 0.25f, 300),
        ItemData.of(new byte[] {1, 2, 3}),
        List.of(new EffectRecord("minecraft:speed", 1, 600, false, true, true)),
        T0);
  }

  @Test
  void nobodyMayJoinUntilTheLastRunsSnapshotsAreLoaded() {
    assertThat(SnapshotBook.UNLOADED.refusal(ALICE)).contains(SnapshotBook.Refusal.NOT_LOADED);

    var loaded = SnapshotBook.UNLOADED.withLoaded(List.of());

    assertThat(loaded.refusal(ALICE)).isEmpty();
  }

  @Test
  void aPlayerWithASnapshotWaitingMustBeRestoredFirst() {
    var book = SnapshotBook.UNLOADED.withLoaded(List.of(snapshot(ALICE, "colosseum")));

    assertThat(book.refusal(ALICE)).contains(SnapshotBook.Refusal.RESTORE_PENDING);
    assertThat(book.refusal(BOB)).isEmpty();
    assertThat(book.holds(ALICE)).isTrue();
  }

  private static SnapshotBook loaded() {
    return SnapshotBook.UNLOADED.withLoaded(List.of());
  }

  @Test
  void aSnapshotIsTakenExactlyOnce() {
    var book = loaded().withHeld(snapshot(ALICE, "colosseum"));

    var first = book.take(ALICE);
    var second = first.book().take(ALICE);

    assertThat(first.snapshot()).contains(snapshot(ALICE, "colosseum"));
    assertThat(second.snapshot()).isEmpty();
    assertThat(first.book().holds(ALICE)).isFalse();
    assertThat(second.book()).isSameAs(first.book());
  }

  @Test
  void aHeldSnapshotBlocksAnotherUntilRestored() {
    var book = loaded().withHeld(snapshot(ALICE, "colosseum"));

    assertThat(book.refusal(ALICE)).contains(SnapshotBook.Refusal.RESTORE_PENDING);
    assertThatThrownBy(() -> book.withHeld(snapshot(ALICE, "maze")))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> SnapshotBook.UNLOADED.withHeld(snapshot(ALICE, "maze")))
        .isInstanceOf(IllegalStateException.class);
  }

  /**
   * The restore order: take the snapshot (put it back and save the player), and only after the
   * stored copy is deleted may a new snapshot be taken. A delete still in flight would otherwise
   * remove the new one.
   */
  @Test
  void aRestoredPlayerMayNotJoinUntilTheStoredSnapshotIsDeleted() {
    var restored = loaded().withHeld(snapshot(ALICE, "colosseum")).take(ALICE).book();

    assertThat(restored.holds(ALICE)).isFalse();
    assertThat(restored.cleaning()).containsExactly(ALICE);
    assertThat(restored.refusal(ALICE)).contains(SnapshotBook.Refusal.CLEANUP_PENDING);
    assertThatThrownBy(() -> restored.withHeld(snapshot(ALICE, "maze")))
        .isInstanceOf(IllegalStateException.class);

    var deleted = restored.cleaned(ALICE);

    assertThat(deleted.refusal(ALICE)).isEmpty();
    assertThat(deleted.withHeld(snapshot(ALICE, "maze")).holds(ALICE)).isTrue();
    assertThat(deleted.cleaned(ALICE)).isSameAs(deleted);
  }

  @Test
  void aStoredSnapshotOfAPlayerStillCleaningUpIsNotLoadedAgain() {
    var cleaning = new SnapshotBook(Map.of(), Set.of(ALICE), false);

    var loaded = cleaning.withLoaded(List.of(snapshot(ALICE, "colosseum")));

    assertThat(loaded.holds(ALICE)).isFalse();
    assertThat(loaded.refusal(ALICE)).contains(SnapshotBook.Refusal.CLEANUP_PENDING);
  }

  @Test
  void aPlayerIsNeverHeldAndCleaningAtOnce() {
    assertThatThrownBy(
            () ->
                new SnapshotBook(Map.of(ALICE, snapshot(ALICE, "colosseum")), Set.of(ALICE), true))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aSnapshotTakenDuringThisRunWinsOverAStoredOne() {
    var fresh = snapshot(ALICE, "maze");
    var book = new SnapshotBook(Map.of(ALICE, fresh), Set.of(), false);

    var loaded = book.withLoaded(List.of(snapshot(ALICE, "colosseum"), snapshot(BOB, "colosseum")));

    assertThat(loaded.held()).containsEntry(ALICE, fresh).containsKey(BOB);
    assertThat(loaded.loaded()).isTrue();
  }

  @Test
  void itemDataIsCopiedAndComparedByContent() {
    var bytes = new byte[] {1, 2, 3};
    var data = ItemData.of(bytes);
    bytes[0] = 9;
    data.bytes()[1] = 9;

    assertThat(data).isEqualTo(ItemData.of(new byte[] {1, 2, 3}));
    assertThat(data).hasSameHashCodeAs(ItemData.of(new byte[] {1, 2, 3}));
    assertThat(data).isNotEqualTo(ItemData.of(new byte[] {1, 2}));
    assertThat(data.size()).isEqualTo(3);
    assertThat(data.toString()).contains("3 bytes");
  }

  @Test
  void snapshotPartsAreChecked() {
    assertThatThrownBy(() -> new Vitals(-1, 20, 0, 0, "SURVIVAL")).hasMessageContaining("health");
    assertThatThrownBy(() -> new Vitals(20, 21, 0, 0, "SURVIVAL")).hasMessageContaining("food");
    assertThatThrownBy(() -> new Vitals(20, 20, 0, 0, " ")).hasMessageContaining("gameMode");
    assertThatThrownBy(() -> new Experience(-1, 0, 0)).hasMessageContaining("negative");
    assertThatThrownBy(() -> new Experience(1, 1.5f, 0)).hasMessageContaining("progress");
    assertThatThrownBy(() -> new EffectRecord("", 0, 1, false, false, false))
        .hasMessageContaining("type");
    assertThatThrownBy(() -> new EffectRecord("minecraft:speed", 0, -2, false, false, false))
        .hasMessageContaining("duration");
    assertThatThrownBy(() -> new Position(" ", 0, 0, 0, 0, 0)).hasMessageContaining("world");
  }
}
