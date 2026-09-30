package com.shepherdjerred.thestorm.qol.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import com.shepherdjerred.thestorm.qol.domain.grave.ItemBytes;
import com.shepherdjerred.thestorm.qol.testing.FakeClock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.OptionalInt;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class AppTest {

  static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");

  static GraveContents grave(int id, UUID owner, int x, Instant at) {
    return new GraveContents(
        new Grave(
            new UUID(0, id), owner, "Owner", new GravePos("world", x, 64, 0), at, "minecraft:air"),
        List.of(new GraveItem(0, OptionalInt.empty(), ItemBytes.of(new byte[] {1}))));
  }

  @Test
  void theRegistryIndexesGravesByIdPositionAndOwner() {
    var registry = new GraveRegistry();
    assertThat(registry.isLoaded()).isFalse();
    var older = grave(1, ALICE, 1, T0);
    var newer = grave(2, ALICE, 2, T0.plusSeconds(5));
    var bobs = grave(3, BOB, 3, T0.plusSeconds(1));

    registry.load(List.of(newer, bobs, older));

    assertThat(registry.isLoaded()).isTrue();
    assertThat(registry.get(new UUID(0, 1))).contains(older);
    assertThat(registry.at(new GravePos("world", 3, 64, 0))).contains(bobs);
    assertThat(registry.at(new GravePos("world", 9, 64, 0))).isEmpty();
    assertThat(registry.ownedBy(ALICE)).containsExactly(older.grave(), newer.grave());
    assertThat(registry.all()).containsExactly(older, bobs, newer);

    registry.remove(new UUID(0, 1));
    assertThat(registry.get(new UUID(0, 1))).isEmpty();
    assertThat(registry.isTaken(new GravePos("world", 1, 64, 0))).isFalse();
  }

  @Test
  void reservedSpotsAreTakenUntilSavedOrReleased() {
    var registry = new GraveRegistry();
    var pos = new GravePos("world", 5, 64, 5);

    registry.reserve(pos, new UUID(0, 9));
    assertThat(registry.isTaken(pos)).isTrue();
    assertThat(registry.isPending(new UUID(0, 9))).isTrue();
    registry.release(pos);
    assertThat(registry.isTaken(pos)).isFalse();
    assertThat(registry.isPending(new UUID(0, 9))).isFalse();

    registry.reserve(new GravePos("world", 1, 64, 0), new UUID(0, 1));
    assertThat(registry.isPending(new UUID(0, 1))).isTrue();
    registry.put(grave(1, ALICE, 1, T0));
    assertThat(registry.isPending(new UUID(0, 1))).isFalse();
    assertThat(registry.isTaken(new GravePos("world", 1, 64, 0))).isTrue();
    registry.remove(new UUID(0, 1));
    assertThat(registry.isTaken(new GravePos("world", 1, 64, 0))).isFalse();
  }

  @Test
  void onlyOneOperationAtATimePerGrave() {
    var registry = new GraveRegistry();
    var id = new UUID(0, 1);

    assertThat(registry.tryLock(id)).isTrue();
    assertThat(registry.tryLock(id)).isFalse();
    assertThat(registry.tryLock(new UUID(0, 2))).isTrue();
    registry.unlock(id);
    assertThat(registry.tryLock(id)).isTrue();
    registry.remove(id);
    assertThat(registry.tryLock(id)).isTrue();
  }

  @Test
  void movingAGraveFreesItsOldPosition() {
    var registry = new GraveRegistry();
    registry.put(grave(1, ALICE, 1, T0));
    registry.put(grave(1, ALICE, 7, T0));

    assertThat(registry.isTaken(new GravePos("world", 1, 64, 0))).isFalse();
    assertThat(registry.isTaken(new GravePos("world", 7, 64, 0))).isTrue();
  }

  @Test
  void theTrackerReportsWhoJustEnteredCombat() {
    var clock = new FakeClock(T0);
    var tracker = new CombatTracker(clock, Duration.ofSeconds(15));

    assertThat(tracker.hit(ALICE, BOB)).containsExactly(ALICE, BOB);
    clock.advance(Duration.ofSeconds(5));
    assertThat(tracker.hit(BOB, ALICE)).isEmpty();
    assertThat(tracker.remaining(ALICE)).contains(Duration.ofSeconds(15));
    assertThat(tracker.inCombat(BOB)).isTrue();
    assertThat(tracker.hit(ALICE, ALICE)).isEmpty();
    assertThat(tracker.tagged()).containsExactly(ALICE, BOB);
  }

  @Test
  void theTrackerSweepsEndedTagsAndClearsTheDead() {
    var clock = new FakeClock(T0);
    var tracker = new CombatTracker(clock, Duration.ofSeconds(15));
    tracker.hit(ALICE, BOB);

    tracker.clear(BOB);
    assertThat(tracker.inCombat(BOB)).isFalse();
    clock.advance(Duration.ofSeconds(15));
    assertThat(tracker.tagged()).isEmpty();
    assertThat(tracker.sweep()).containsExactly(ALICE);
    assertThat(tracker.sweep()).isEmpty();

    tracker.hit(ALICE, BOB);
    tracker.clearAll();
    assertThat(tracker.inCombat(ALICE)).isFalse();
  }
}
