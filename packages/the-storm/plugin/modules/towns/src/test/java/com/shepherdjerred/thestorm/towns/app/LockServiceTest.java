package com.shepherdjerred.thestorm.towns.app;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAttempt;
import com.shepherdjerred.thestorm.towns.domain.lock.LockGrant;
import com.shepherdjerred.thestorm.towns.domain.lock.LockPolicy;
import com.shepherdjerred.thestorm.towns.domain.lock.LockProblem;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;

/** Locking, unlocking, trusting and following blocks, saved behind memory and undone on failure. */
final class LockServiceTest {

  private static final BlockPos LEFT = new BlockPos("world", 10, 64, 10);
  private static final BlockPos RIGHT = new BlockPos("world", 11, 64, 10);
  private static final LockAttempt.Standing MINE =
      new LockAttempt.Standing(OWNER, true, LockAttempt.Ground.OPEN, false);

  private final FakeLocksStore store = new FakeLocksStore();
  private final List<Throwable> reloadFailures = new ArrayList<>();
  private final LockService locks =
      new LockService(
          new LockBook(),
          store,
          new LockPolicy(2, true),
          new Clocks(
              InstantSource.fixed(Instant.parse("2026-09-25T12:00:00Z")),
              new SplittableRandom(3),
              Runnable::run,
              reloadFailures::add));

  private static Lock ok(Result<Change<Lock>, List<LockProblem>> result) {
    return result.fold(
        Change::value,
        problems -> {
          throw new AssertionError("expected success, got " + problems);
        });
  }

  @Test
  void aLockProtectsAtOnceAndIsSaved() {
    var lock = ok(locks.lock(OWNER, List.of(LEFT, RIGHT), MINE));

    assertThat(locks.book().lockAt(RIGHT)).contains(lock);
    assertThat(locks.isSettling()).isTrue();
    store.succeed();
    assertThat(store.saved).containsValue(lock);
    assertThat(locks.isSettling()).isFalse();
  }

  @Test
  void aFailedSaveReloadsTheStoredLocks() {
    ok(locks.lock(OWNER, List.of(LEFT), MINE));

    store.fail();

    assertThat(locks.book().lockAt(LEFT)).isEmpty();
    assertThat(locks.isSettling()).isFalse();
  }

  @Test
  void theLimitCountsLocksNotBlocks() {
    ok(locks.lock(OWNER, List.of(LEFT, RIGHT), MINE));
    ok(locks.lock(OWNER, List.of(new BlockPos("world", 0, 64, 0)), MINE));

    assertThat(locks.lock(OWNER, List.of(new BlockPos("world", 5, 64, 0)), MINE))
        .isEqualTo(Result.err(List.of(new LockProblem.LimitReached(2))));
  }

  @Test
  void onlyTheOwnerUnlocksUnlessBypassing() {
    ok(locks.lock(OWNER, List.of(LEFT), MINE));
    store.succeed();

    assertThat(locks.unlock(LEFT, false))
        .isEqualTo(Result.err(List.of(new LockProblem.NotYourLock())));
    ok(locks.unlock(LEFT, true));
    store.succeed();
    assertThat(locks.book().lockAt(LEFT)).isEmpty();
    assertThat(store.saved).isEmpty();
  }

  @Test
  void unlockingKeepsTheLockUntilDeletionSucceedsAndRetainsItOnFailure() {
    var lock = ok(locks.lock(OWNER, List.of(LEFT), MINE));
    store.succeed();

    var unlocked = ok(locks.unlock(LEFT, true));
    assertThat(locks.book().lockAt(LEFT)).contains(lock);
    assertThat(locks.isSettling()).isTrue();
    store.fail();

    assertThat(locks.book().lockAt(LEFT)).contains(lock);
    assertThat(store.saved).containsKey(lock.id());
    assertThat(unlocked).isEqualTo(lock);
    assertThat(locks.isSettling()).isFalse();
  }

  @Test
  void aLockBeingSavedTakesNoOtherCommand() {
    ok(locks.lock(OWNER, List.of(LEFT), MINE));

    assertThat(locks.unlock(LEFT, true)).isEqualTo(Result.err(List.of(new LockProblem.Busy())));
    assertThat(locks.trust(OWNER, LEFT, new PlayerRef(NOMAD, "Nomad"), Optional.of(LockGrant.USE)))
        .isEqualTo(Result.err(List.of(new LockProblem.Busy())));
  }

  @Test
  void trustIsSaved() {
    ok(locks.lock(OWNER, List.of(LEFT), MINE));
    store.succeed();

    var trusted =
        ok(locks.trust(OWNER, LEFT, new PlayerRef(NOMAD, "Nomad"), Optional.of(LockGrant.USE)));
    store.succeed();

    assertThat(trusted.trusted()).containsEntry(NOMAD, LockGrant.USE);
    assertThat(store.saved).containsValue(trusted);
  }

  @Test
  void breakingOneHalfKeepsTheOtherLockedAndBreakingTheLastDeletesIt() {
    var lock = ok(locks.lock(OWNER, List.of(LEFT, RIGHT), MINE));
    store.succeed();

    locks.release(LEFT);
    store.succeed();
    assertThat(locks.book().lockAt(LEFT)).isEmpty();
    assertThat(locks.book().lockAt(RIGHT).orElseThrow().blocks()).containsExactly(RIGHT);

    locks.release(RIGHT);
    store.succeed();
    assertThat(locks.book().lockAt(RIGHT)).isEmpty();
    assertThat(store.saved).doesNotContainKey(lock.id());
    assertThat(locks.book().countOf(OWNER)).isZero();

    locks.release(RIGHT);
    assertThat(store.pending()).isZero();
  }

  @Test
  void aJoinedHalfIsLockedWithTheOtherButNeverThreeBlocks() {
    var lock = ok(locks.lock(OWNER, List.of(LEFT), MINE));
    store.succeed();

    locks.extend(lock, RIGHT);
    store.succeed();
    var grown = locks.book().lockAt(RIGHT).orElseThrow();
    assertThat(grown.blocks()).containsExactlyInAnyOrder(LEFT, RIGHT);

    locks.extend(grown, new BlockPos("world", 12, 64, 10));
    assertThat(store.pending()).isZero();
  }

  @Test
  void leavingPlayerHandsOverOnlyLocksEntirelyInsideTheTown() {
    var placed = new LockAttempt.Standing(NOMAD, true, LockAttempt.Ground.OPEN, false);
    var inside = ok(locks.lock(NOMAD, List.of(LEFT), placed));
    store.succeed();
    var outside = ok(locks.lock(NOMAD, List.of(RIGHT), placed));
    store.succeed();

    store.saved.put(inside.id(), inside.ownedBy(OWNER));
    var handed = locks.applyCommittedHandover(Set.of(inside.id()), NOMAD, OWNER);
    assertThat(handed).hasSize(1);
    assertThat(handed.getFirst().owner()).isEqualTo(OWNER);
    assertThat(locks.book().lockAt(LEFT).orElseThrow().owner()).isEqualTo(OWNER);
    assertThat(locks.book().lockAt(RIGHT)).contains(outside);
    assertThat(store.pending()).isZero();
    assertThat(store.saved).containsEntry(inside.id(), handed.getFirst());
  }

  @Test
  void ownerBusyRefusesCommandsAndDefersPhysicalChangesUntilHandover() {
    var busy = new AtomicBoolean();
    var service =
        new LockService(
            new LockBook(),
            store,
            new LockService.Dependencies(
                new LockPolicy(2, true),
                new Clocks(
                    InstantSource.fixed(Instant.parse("2026-09-25T12:00:00Z")),
                    new SplittableRandom(4),
                    Runnable::run,
                    reloadFailures::add),
                owner -> owner.equals(NOMAD) && busy.get()));
    var standing = new LockAttempt.Standing(NOMAD, true, LockAttempt.Ground.OPEN, false);
    var lock = ok(service.lock(NOMAD, List.of(LEFT), standing));
    store.succeed();

    busy.set(true);
    assertThat(service.lock(NOMAD, List.of(RIGHT), standing))
        .isEqualTo(Result.err(List.of(new LockProblem.Busy())));
    service.release(LEFT);
    assertThat(service.book().lockAt(LEFT)).contains(lock);
    assertThat(store.pending()).isZero();

    store.saved.put(lock.id(), lock.ownedBy(OWNER));
    service.applyCommittedHandover(Set.of(lock.id()), NOMAD, OWNER);
    busy.set(false);
    service.flushDeferred();
    assertThat(service.book().lockAt(LEFT)).isEmpty();
    assertThat(store.pending()).isEqualTo(1);
    store.succeed();
    assertThat(store.saved).doesNotContainKey(lock.id());
  }

  /** Keeps saved locks; each write waits until the test completes it. Reloads return the saved. */
  private static final class FakeLocksStore implements LocksStore {

    final Map<UUID, Lock> saved = new LinkedHashMap<>();
    private final List<Runnable> applies = new ArrayList<>();
    private final List<CompletableFuture<Void>> writes = new ArrayList<>();

    int pending() {
      return writes.size();
    }

    void succeed() {
      applies.removeFirst().run();
      writes.removeFirst().complete(null);
    }

    void fail() {
      applies.removeFirst();
      writes.removeFirst().completeExceptionally(new IllegalStateException("disk full"));
    }

    private CompletableFuture<Void> record(Runnable apply) {
      var write = new CompletableFuture<Void>();
      applies.add(apply);
      writes.add(write);
      return write;
    }

    @Override
    public CompletableFuture<List<Lock>> loadAll() {
      return CompletableFuture.completedFuture(List.copyOf(saved.values()));
    }

    @Override
    public CompletableFuture<Void> save(Lock lock) {
      return record(() -> saved.put(lock.id(), lock));
    }

    @Override
    public CompletableFuture<Void> delete(UUID id) {
      return record(() -> saved.remove(id));
    }
  }
}
