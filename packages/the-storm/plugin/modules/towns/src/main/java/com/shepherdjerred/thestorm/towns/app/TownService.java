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
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * The towns use cases. Each validates against the in-memory state, applies the change there at once
 * (so protection follows immediately), and writes it to storage; a failed write rolls the memory
 * back. Main thread only.
 */
public final class TownService {

  private final TownsState state;
  private final TownsStore store;
  private final Claiming claiming;
  private final Clocks clocks;

  public TownService(TownsState state, TownsStore store, Claiming claiming, Clocks clocks) {
    this.state = state;
    this.store = store;
    this.claiming = claiming;
    this.clocks = clocks;
  }

  public Result<Change<Town>, List<TownProblem>> found(UUID founder, String name) {
    var founding =
        new Founding(founder, name, TownRules.newId(clocks.random()), clocks.time().instant());
    return TownRules.found(founding, state)
        .map(
            town -> {
              state.addTown(town);
              return persist(town, store.createTown(town), () -> state.removeTown(town.id()));
            });
  }

  public Result<Change<Town>, List<TownProblem>> disband(UUID player, String confirmation) {
    return TownRules.disband(player, confirmation, state)
        .map(
            town -> {
              var claims = state.removeTown(town.id());
              return persist(town, store.deleteTown(town.id()), () -> restore(town, claims));
            });
  }

  public Result<Change<Claim>, List<ClaimProblem>> claim(UUID player, ChunkPos chunk) {
    return Claiming.attempt(player, state.townOf(player), chunk, state)
        .flatMap(claiming::claim)
        .map(
            claim -> {
              state.addClaim(claim);
              return persist(
                  claim,
                  store.addClaim(claim, clocks.time().instant()),
                  () -> removeIfUnchanged(claim));
            });
  }

  public Result<Change<Claim>, List<ClaimProblem>> unclaim(UUID player, ChunkPos chunk) {
    return Claiming.attempt(player, state.townOf(player), chunk, state)
        .flatMap(claiming::unclaim)
        .map(
            claim -> {
              state.removeClaim(claim.chunk());
              return persist(claim, store.removeClaim(claim.chunk()), () -> readdIfFree(claim));
            });
  }

  public Result<Change<Claim>, List<ClaimProblem>> setFlag(
      UUID player, ChunkPos chunk, ClaimFlag flag, boolean on) {
    return Claiming.attempt(player, state.townOf(player), chunk, state)
        .flatMap(attempt -> claiming.setFlag(attempt, flag, on))
        .map(
            claim -> {
              var previous = state.claimAt(chunk).orElseThrow();
              state.replaceClaim(claim);
              return persist(
                  claim, store.saveFlags(claim), () -> revertFlagsIfUnchanged(claim, previous));
            });
  }

  private <T> Change<T> persist(T value, CompletableFuture<Void> write, Runnable rollback) {
    var saved =
        write.whenCompleteAsync(
            (ok, failure) -> {
              if (failure != null) {
                rollback.run();
              }
            },
            clocks.mainThread());
    return new Change<>(value, saved);
  }

  private void restore(Town town, List<Claim> claims) {
    if (state.town(town.id()).isPresent() || state.named(town.name()).isPresent()) {
      return;
    }
    if (town.members().keySet().stream().anyMatch(member -> state.townOf(member).isPresent())) {
      return;
    }
    state.addTown(town);
    claims.stream()
        .filter(claim -> state.claimAt(claim.chunk()).isEmpty())
        .forEach(state::addClaim);
  }

  private void removeIfUnchanged(Claim claim) {
    if (state.claimAt(claim.chunk()).filter(claim::equals).isPresent()) {
      state.removeClaim(claim.chunk());
    }
  }

  private void readdIfFree(Claim claim) {
    if (state.claimAt(claim.chunk()).isEmpty() && state.town(claim.townId()).isPresent()) {
      state.addClaim(claim);
    }
  }

  private void revertFlagsIfUnchanged(Claim applied, Claim previous) {
    if (state.claimAt(applied.chunk()).filter(applied::equals).isPresent()) {
      state.replaceClaim(previous);
    }
  }
}
