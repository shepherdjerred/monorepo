package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/**
 * Keeps the in-memory towns and storage in step for every towns use case. Main thread only.
 *
 * <p>While a change is being saved, its town, its players and its chunks are busy: other changes to
 * them are refused, so no change is ever validated against a state that might still be undone. If a
 * save fails, every change is refused while the whole state is reloaded from storage, the one
 * source of truth; nothing is patched back by hand.
 */
public final class Settling {

  private final TownsState state;
  private final TownsStore store;
  private final Clocks clocks;
  private final TownEvents events;
  private final Set<UUID> busyTowns = new HashSet<>();
  private final Set<UUID> busyPlayers = new HashSet<>();
  private final Set<ChunkPos> busyChunks = new HashSet<>();
  private final List<Runnable> settledListeners = new ArrayList<>();
  private boolean reloading;

  public Settling(TownsState state, TownsStore store, Clocks clocks, TownEvents events) {
    this.state = state;
    this.store = store;
    this.clocks = clocks;
    this.events = events;
  }

  public TownsState state() {
    return state;
  }

  public TownsStore store() {
    return store;
  }

  public Clocks clocks() {
    return clocks;
  }

  public TownEvents events() {
    return events;
  }

  /** True while a save is outstanding or the state is being reloaded, for tests and status. */
  public boolean isSettling() {
    return reloading || !busyTowns.isEmpty() || !busyChunks.isEmpty() || !busyPlayers.isEmpty();
  }

  /** True when any part of {@code busy} is still being saved, or everything is reloading. */
  public boolean isBusy(Busy busy) {
    return reloading
        || busyTowns.contains(busy.town())
        || busy.players().stream().anyMatch(busyPlayers::contains)
        || busy.chunks().stream().anyMatch(busyChunks::contains);
  }

  /** True when {@code chunk} is busy. */
  public boolean isChunkBusy(ChunkPos chunk) {
    return reloading || busyChunks.contains(chunk);
  }

  /** True when {@code player} or their town is busy. */
  public boolean isPlayerBusy(UUID player) {
    return reloading
        || busyPlayers.contains(player)
        || state.townIdOf(player).filter(busyTowns::contains).isPresent();
  }

  /**
   * Holds {@code busy} while something outside storage (a treasury payout) finishes; release it
   * with {@link #release}. Returns false, holding nothing, when it is already busy.
   */
  public boolean hold(Busy busy) {
    if (isBusy(busy)) {
      return false;
    }
    mark(busy);
    return true;
  }

  public void release(Busy busy) {
    busyTowns.remove(busy.town());
    busyPlayers.removeAll(busy.players());
    busyChunks.removeAll(busy.chunks());
    settledListeners.forEach(Runnable::run);
  }

  /** Called after a successful save or completed reload has made pending players available. */
  public void onSettled(Runnable listener) {
    settledListeners.add(listener);
  }

  /**
   * Keeps {@code busy} until {@code write} finishes; if it fails, reloads everything from storage.
   * The change completes once saved, or exceptionally once memory is back to the stored truth.
   */
  public <T> Change<T> persist(T value, CompletableFuture<Void> write, Busy busy) {
    return persist(value, write, busy, () -> {});
  }

  /**
   * As {@link #persist(Object, CompletableFuture, Busy)}, running {@code afterSave} on the main
   * thread once the write is saved and before the change completes; it never runs for a change that
   * was undone.
   */
  public <T> Change<T> persist(
      T value, CompletableFuture<Void> write, Busy busy, Runnable afterSave) {
    mark(busy);
    var saved = new CompletableFuture<Void>();
    var _ =
        write.whenCompleteAsync(
            (ok, failure) -> {
              if (failure == null) {
                completeSave(saved, busy, afterSave);
                return;
              }
              reloading = true;
              release(busy);
              reload(saved, failure);
            },
            clocks.mainThread());
    return new Change<>(value, saved);
  }

  /**
   * Passes a committed write's result to memory while the affected town and players remain busy.
   */
  public <T, R> Change<T> persistResult(
      T value, CompletableFuture<R> write, Busy busy, Consumer<R> afterSave) {
    mark(busy);
    var saved = new CompletableFuture<Void>();
    var _ =
        write.whenCompleteAsync(
            (result, failure) -> {
              if (failure == null) {
                completeSave(saved, busy, () -> afterSave.accept(result));
                return;
              }
              reloading = true;
              release(busy);
              reload(saved, failure);
            },
            clocks.mainThread());
    return new Change<>(value, saved);
  }

  private void completeSave(CompletableFuture<Void> saved, Busy busy, Runnable afterSave) {
    RuntimeException failure = null;
    try {
      afterSave.run();
    } catch (RuntimeException callbackFailure) {
      failure = callbackFailure;
    }
    try {
      release(busy);
    } catch (RuntimeException releaseFailure) {
      if (failure != null) {
        failure.addSuppressed(releaseFailure);
      } else {
        failure = releaseFailure;
      }
    }
    if (failure == null) {
      saved.complete(null);
    } else {
      saved.completeExceptionally(failure);
    }
  }

  private void mark(Busy busy) {
    busyTowns.add(busy.town());
    busyPlayers.addAll(busy.players());
    busyChunks.addAll(busy.chunks());
  }

  private void reload(CompletableFuture<Void> saved, Throwable failure) {
    reloading = true;
    var _ =
        store
            .loadAll()
            .whenCompleteAsync(
                (snapshot, loadFailure) -> {
                  if (loadFailure != null) {
                    clocks.reloadFailed().accept(loadFailure);
                  } else {
                    state.reload(snapshot);
                    reloading = false;
                    events.reloaded();
                    settledListeners.forEach(Runnable::run);
                  }
                  saved.completeExceptionally(failure);
                },
                clocks.mainThread());
  }

  /**
   * What a change keeps busy until it is saved.
   *
   * @param town the town
   * @param players players whose membership it touches
   * @param chunks chunks it touches
   */
  public record Busy(UUID town, Set<UUID> players, Set<ChunkPos> chunks) {

    public Busy {
      players = Set.copyOf(players);
      chunks = Set.copyOf(chunks);
    }

    /** The town, every member and {@code chunks}. */
    public static Busy of(Town town, Set<ChunkPos> chunks) {
      return new Busy(town.id(), town.members().keySet(), chunks);
    }

    /** The claim's chunk. */
    public static Busy of(Claim claim) {
      return new Busy(claim.townId(), Set.of(), Set.of(claim.chunk()));
    }
  }
}
