package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAttempt;
import com.shepherdjerred.thestorm.towns.domain.lock.LockGrant;
import com.shepherdjerred.thestorm.towns.domain.lock.LockPolicy;
import com.shepherdjerred.thestorm.towns.domain.lock.LockProblem;
import com.shepherdjerred.thestorm.towns.domain.lock.LockRules;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import com.shepherdjerred.thestorm.towns.domain.town.TownRules;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * Locking, unlocking and trusting containers, and keeping locks in step with the blocks they cover.
 * Changes apply to the {@link LockBook} at once and are saved behind it; while a lock is being
 * saved, commands on it are refused. If a save fails every lock is reloaded from storage, and lock
 * commands are refused until that finishes. Main thread only.
 */
public final class LockService {

  private final LockBook book;
  private final LocksStore store;
  private final LockPolicy policy;
  private final Clocks clocks;
  private final Predicate<UUID> ownerBusy;

  /** Saves outstanding per lock id. */
  private final Map<UUID, Integer> busy = new HashMap<>();

  private boolean reloading;

  /** World changes held while locks reload or their owner leaves a town. */
  private final List<Deferred> deferred = new ArrayList<>();

  private record Deferred(Optional<UUID> owner, Runnable change) {}

  /** Policy, clocks and membership settlement needed by lock writes. */
  public record Dependencies(LockPolicy policy, Clocks clocks, Predicate<UUID> ownerBusy) {}

  public LockService(LockBook book, LocksStore store, LockPolicy policy, Clocks clocks) {
    this(book, store, new Dependencies(policy, clocks, owner -> false));
  }

  public LockService(LockBook book, LocksStore store, Dependencies dependencies) {
    this.book = book;
    this.store = store;
    this.policy = dependencies.policy();
    this.clocks = dependencies.clocks();
    this.ownerBusy = dependencies.ownerBusy();
  }

  public LockBook book() {
    return book;
  }

  public LockPolicy policy() {
    return policy;
  }

  /** Locks the container made of {@code blocks} for {@code player}. */
  public Result<Change<Lock>, List<LockProblem>> lock(
      UUID player, List<BlockPos> blocks, LockAttempt.Standing standing) {
    if (reloading || ownerBusy.test(player)) {
      return refusedBusy();
    }
    var attempt = new LockAttempt(player, blocks, standing, TownRules.newId(clocks.random()));
    return LockRules.lock(attempt, book, policy)
        .map(
            lock -> {
              book.put(lock);
              return persist(lock, store.save(lock));
            });
  }

  /**
   * Removes the lock on {@code block}; {@code mayUnlock} is whether {@code LockAccess#unlocking}
   * lets {@code player} do it.
   */
  public Result<Change<Lock>, List<LockProblem>> unlock(BlockPos block, boolean mayUnlock) {
    var lock = book.lockAt(block);
    if (isBusy(lock)) {
      return refusedBusy();
    }
    return LockRules.unlock(lock, mayUnlock)
        .map(
            found -> {
              return persistUnlock(found);
            });
  }

  /** Keep the old lock authoritative until storage confirms its deletion. */
  private Change<Lock> persistUnlock(Lock lock) {
    busy.merge(lock.id(), 1, Integer::sum);
    var saved = new CompletableFuture<Void>();
    var _ =
        store
            .delete(lock.id())
            .whenCompleteAsync(
                (ok, failure) -> {
                  settle(lock.id());
                  if (failure == null) {
                    book.remove(lock.id());
                    saved.complete(null);
                  } else {
                    reload(saved, failure);
                  }
                },
                clocks.mainThread());
    return new Change<>(lock, saved);
  }

  /**
   * Trusts {@code target} on the lock on {@code block} with {@code grant}, or stops trusting them
   * when {@code grant} is empty.
   */
  public Result<Change<Lock>, List<LockProblem>> trust(
      UUID player, BlockPos block, PlayerRef target, Optional<LockGrant> grant) {
    return change(block, lock -> LockRules.trust(player, lock, target, grant));
  }

  /** Shares the lock on {@code block} with its owner's town (opening only), or stops sharing. */
  public Result<Change<Lock>, List<LockProblem>> shareWithTown(
      UUID player, BlockPos block, boolean on) {
    return change(block, lock -> LockRules.shareWithTown(player, lock, on));
  }

  /** Lets redstone dispense or craft from the lock on {@code block}, or not. */
  public Result<Change<Lock>, List<LockProblem>> redstone(UUID player, BlockPos block, boolean on) {
    return change(block, lock -> LockRules.redstone(player, lock, on));
  }

  private Result<Change<Lock>, List<LockProblem>> change(
      BlockPos block, Function<Optional<Lock>, Result<Lock, List<LockProblem>>> rule) {
    var lock = book.lockAt(block);
    if (isBusy(lock)) {
      return refusedBusy();
    }
    return rule.apply(lock)
        .map(
            updated -> {
              book.put(updated);
              return persist(updated, store.save(updated));
            });
  }

  private boolean isBusy(Optional<Lock> lock) {
    return reloading
        || lock.filter(found -> busy.containsKey(found.id()) || ownerBusy.test(found.owner()))
            .isPresent();
  }

  /** Applies the exact lock ids already transferred with a committed membership write. */
  public List<Lock> applyCommittedHandover(Set<UUID> lockIds, UUID from, UUID to) {
    var original = new ArrayList<Lock>();
    for (var id : lockIds) {
      var lock =
          book.byId(id)
              .orElseThrow(() -> new IllegalStateException("committed lock is absent: " + id));
      if (!lock.owner().equals(from)) {
        throw new IllegalStateException("committed lock has unexpected owner: " + id);
      }
      original.add(lock);
    }
    var handed = new ArrayList<Lock>();
    for (var lock : original) {
      var taken = lock.ownedBy(to);
      book.put(taken);
      handed.add(taken);
    }
    return List.copyOf(handed);
  }

  /**
   * The block at {@code block} is gone (broken, or replaced by a new block): its lock no longer
   * covers it, and a lock left covering nothing is deleted.
   */
  public void release(BlockPos block) {
    if (reloading) {
      deferred.add(new Deferred(Optional.empty(), () -> release(block)));
      return;
    }
    book.lockAt(block).ifPresent(lock -> whenSettled(lock.owner(), () -> releaseNow(block)));
  }

  private void releaseNow(BlockPos block) {
    var found = book.lockAt(block);
    if (found.isEmpty()) {
      return;
    }
    var lock = found.get();
    if (lock.blocks().size() == 1) {
      book.remove(lock.id());
      var _ = persist(lock, store.delete(lock.id()));
      return;
    }
    var shrunk = lock.withoutBlock(block);
    book.put(shrunk);
    var _ = persist(shrunk, store.save(shrunk));
  }

  /** {@code lock} also covers {@code block}, a chest joined to it as its other half. */
  public void extend(Lock lock, BlockPos block) {
    whenSettled(
        lock.owner(),
        () -> {
          var current = book.byId(lock.id());
          if (current.isPresent()) {
            extendNow(current.get(), block);
          }
        });
  }

  private void extendNow(Lock lock, BlockPos block) {
    if (lock.blocks().size() >= Lock.MAX_BLOCKS || book.lockAt(block).isPresent()) {
      return;
    }
    var grown = lock.withBlock(block);
    book.put(grown);
    var _ = persist(grown, store.save(grown));
  }

  private Change<Lock> persist(Lock lock, CompletableFuture<Void> write) {
    busy.merge(lock.id(), 1, Integer::sum);
    var saved = new CompletableFuture<Void>();
    var _ =
        write.whenCompleteAsync(
            (ok, failure) -> {
              settle(lock.id());
              if (failure == null) {
                saved.complete(null);
              } else {
                reload(saved, failure);
              }
            },
            clocks.mainThread());
    return new Change<>(lock, saved);
  }

  private void reload(CompletableFuture<Void> saved, Throwable failure) {
    reloading = true;
    var _ =
        store
            .loadAll()
            .whenCompleteAsync(
                (locks, loadFailure) -> {
                  if (loadFailure != null) {
                    clocks.reloadFailed().accept(loadFailure);
                  } else {
                    book.reload(locks);
                    reloading = false;
                    flushDeferred();
                  }
                  saved.completeExceptionally(failure);
                },
                clocks.mainThread());
  }

  /**
   * Runs {@code change} now, or once a reload finishes: a block broken or joined while locks are
   * being reloaded from storage is applied to the reloaded locks, not lost.
   */
  private void whenSettled(UUID owner, Runnable change) {
    if (reloading || ownerBusy.test(owner)) {
      deferred.add(new Deferred(Optional.of(owner), change));
    } else {
      change.run();
    }
  }

  /** Applies world changes held during membership or lock settlement. Main thread only. */
  public void flushDeferred() {
    if (reloading) {
      return;
    }
    var waiting = List.copyOf(deferred);
    deferred.clear();
    for (var item : waiting) {
      item.owner().ifPresentOrElse(owner -> whenSettled(owner, item.change()), item.change());
    }
  }

  /** True while a save is outstanding or locks are reloading, for tests. */
  public boolean isSettling() {
    return reloading || !busy.isEmpty();
  }

  private void settle(UUID id) {
    var count = busy.getOrDefault(id, 0);
    if (count <= 1) {
      busy.remove(id);
    } else {
      busy.put(id, count - 1);
    }
  }

  private static <T> Result<T, List<LockProblem>> refusedBusy() {
    return Result.err(List.of(new LockProblem.Busy()));
  }
}
