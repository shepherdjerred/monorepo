package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.claiming.Claiming;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.town.Founding;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRules;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * The towns use cases. Each validates against the in-memory state, applies the change there at once
 * (so protection follows immediately), and writes it to storage. Main thread only.
 *
 * <p>While a change is being saved, its town, its players and its chunk are busy: other changes to
 * them are refused, so no change is ever validated against a state that might still be undone. If a
 * save fails, every change is refused while the whole state is reloaded from storage, the one
 * source of truth; nothing is patched back by hand.
 */
public final class TownService {

  private final TownsState state;
  private final TownsStore store;
  private final Claiming claiming;
  private final Clocks clocks;
  private final Set<UUID> busyTowns = new HashSet<>();
  private final Set<UUID> busyPlayers = new HashSet<>();
  private final Set<ChunkPos> busyChunks = new HashSet<>();
  private boolean reloading;

  public TownService(TownsState state, TownsStore store, Claiming claiming, Clocks clocks) {
    this.state = state;
    this.store = store;
    this.claiming = claiming;
    this.clocks = clocks;
  }

  public Result<Change<Town>, List<TownProblem>> found(UUID founder, String name) {
    if (reloading || busyPlayers.contains(founder)) {
      return Result.err(List.of(new TownProblem.Busy()));
    }
    var founding =
        new Founding(founder, name, TownRules.newId(clocks.random()), clocks.time().instant());
    return TownRules.found(founding, state)
        .map(
            town -> {
              state.addTown(town);
              var busy = Busy.of(town, Set.of());
              return persist(town, store.createTown(town), busy);
            });
  }

  public Result<Change<Town>, List<TownProblem>> disband(UUID player, String confirmation) {
    if (reloading || busyPlayers.contains(player)) {
      return Result.err(List.of(new TownProblem.Busy()));
    }
    return TownRules.disband(player, confirmation, state)
        .flatMap(
            town ->
                busyTowns.contains(town.id())
                    ? Result.<Town, List<TownProblem>>err(List.of(new TownProblem.Busy()))
                    : Result.ok(town))
        .map(
            town -> {
              var claims = state.removeTown(town.id());
              var chunks = new HashSet<ChunkPos>();
              claims.forEach(claim -> chunks.add(claim.chunk()));
              return persist(town, store.deleteTown(town.id()), Busy.of(town, chunks));
            });
  }

  public Result<Change<Claim>, List<ClaimProblem>> claim(UUID player, ChunkPos chunk) {
    return busyFor(player, chunk)
        .flatMap(ok -> Claiming.attempt(player, state.townOf(player), chunk, state))
        .flatMap(claiming::claim)
        .map(
            claim -> {
              state.addClaim(claim);
              return persist(claim, store.addClaim(claim, clocks.time().instant()), Busy.of(claim));
            });
  }

  public Result<Change<Claim>, List<ClaimProblem>> unclaim(UUID player, ChunkPos chunk) {
    return busyFor(player, chunk)
        .flatMap(ok -> Claiming.attempt(player, state.townOf(player), chunk, state))
        .flatMap(claiming::unclaim)
        .map(
            claim -> {
              state.removeClaim(claim.chunk());
              return persist(claim, store.removeClaim(claim.chunk()), Busy.of(claim));
            });
  }

  public Result<Change<Claim>, List<ClaimProblem>> setFlag(
      UUID player, ChunkPos chunk, ClaimFlag flag, boolean on) {
    return busyFor(player, chunk)
        .flatMap(ok -> Claiming.attempt(player, state.townOf(player), chunk, state))
        .flatMap(attempt -> claiming.setFlag(attempt, flag, on))
        .map(
            claim -> {
              state.replaceClaim(claim);
              return persist(claim, store.saveFlags(claim), Busy.of(claim));
            });
  }

  /** True while a save is outstanding or the state is being reloaded, for tests and status. */
  public boolean isSettling() {
    return reloading || !busyTowns.isEmpty() || !busyChunks.isEmpty() || !busyPlayers.isEmpty();
  }

  private Result<Boolean, List<ClaimProblem>> busyFor(UUID player, ChunkPos chunk) {
    var town = state.townOf(player).map(Town::id);
    var busy =
        reloading
            || busyPlayers.contains(player)
            || busyChunks.contains(chunk)
            || town.filter(busyTowns::contains).isPresent();
    return busy ? Result.err(List.of(new ClaimProblem.Busy())) : Result.ok(true);
  }

  private <T> Change<T> persist(T value, CompletableFuture<Void> write, Busy busy) {
    busyTowns.add(busy.town());
    busyPlayers.addAll(busy.players());
    busyChunks.addAll(busy.chunks());
    var saved = new CompletableFuture<Void>();
    var _ =
        write.whenCompleteAsync(
            (ok, failure) -> {
              busyTowns.remove(busy.town());
              busyPlayers.removeAll(busy.players());
              busyChunks.removeAll(busy.chunks());
              if (failure == null) {
                saved.complete(null);
                return;
              }
              reload(saved, failure);
            },
            clocks.mainThread());
    return new Change<>(value, saved);
  }

  /** Reloads the stored truth after a failed save; {@code saved} fails once memory matches it. */
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
                  }
                  saved.completeExceptionally(failure);
                },
                clocks.mainThread());
  }

  /** What a change keeps busy until it is saved. */
  private record Busy(UUID town, Set<UUID> players, Set<ChunkPos> chunks) {

    static Busy of(Town town, Set<ChunkPos> chunks) {
      return new Busy(town.id(), Set.copyOf(town.members().keySet()), Set.copyOf(chunks));
    }

    static Busy of(Claim claim) {
      return new Busy(claim.townId(), Set.of(), Set.of(claim.chunk()));
    }
  }
}
