package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimAttempt;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.claiming.Claiming;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.town.Founding;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRules;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Founding and deleting towns, and their land: claims, flags and claim trust. Each use case
 * validates against the in-memory state and saves it through {@link Settling}. Permission-reducing
 * changes apply at once; permission-expanding changes become visible only after storage commits.
 * Main thread only.
 *
 * <p>A claim is checked against the owner's live Governor level when they are online, and that
 * level is stored with the claim, so the town's limit holds while they are away.
 */
public final class TownService {

  private final Settling settling;
  private final Claiming claiming;
  private final OwnerLevels levels;

  public TownService(Settling settling, Claiming claiming, OwnerLevels levels) {
    this.settling = settling;
    this.claiming = claiming;
    this.levels = levels;
  }

  public Settling settling() {
    return settling;
  }

  /** Founds a town owned by {@code founder}, whose Governor level is {@code governorLevel}. */
  public Result<Change<Town>, List<TownProblem>> found(
      UUID founder, String name, int governorLevel) {
    if (settling.isPlayerBusy(founder)) {
      return Result.err(List.of(new TownProblem.Busy()));
    }
    var clocks = settling.clocks();
    var founding =
        new Founding(
            founder,
            name,
            TownRules.newId(clocks.random()),
            clocks.time().instant(),
            governorLevel);
    return TownRules.found(founding, state())
        .map(
            town -> {
              state().addTown(town);
              return settling.persist(
                  town, settling.store().createTown(town), Settling.Busy.of(town, Set.of()));
            });
  }

  /** The town {@code player} may delete now, confirmed by repeating its name. */
  public Result<Town, List<TownProblem>> checkDisband(UUID player, String confirmation) {
    return TownRules.disband(player, confirmation, state())
        .flatMap(
            town ->
                settling.isBusy(Settling.Busy.of(town, Set.of()))
                    ? Result.<Town, List<TownProblem>>err(List.of(new TownProblem.Busy()))
                    : Result.ok(town));
  }

  /** Deletes {@code player}'s town and durably records its treasury payout for {@link Treasury}. */
  public Result<Change<Town>, List<TownProblem>> disband(UUID player, String confirmation) {
    return checkDisband(player, confirmation)
        .map(
            town -> {
              var claims = state().claimsOf(town.id());
              var chunks = new HashSet<ChunkPos>();
              claims.forEach(claim -> chunks.add(claim.chunk()));
              return settling.persist(
                  town,
                  settling.store().deleteTown(TownPayout.of(town)),
                  Settling.Busy.of(town, chunks),
                  () -> {
                    state().removeTown(town.id());
                    settling.events().removed(town.id());
                  });
            });
  }

  public Result<Change<Claim>, List<ClaimProblem>> claim(UUID player, ChunkPos chunk) {
    return attempt(player, chunk)
        .flatMap(
            attempt -> {
              var town = withLiveLevel(attempt.town());
              var fresh = new ClaimAttempt(player, town, chunk, attempt.map());
              return claiming.claim(fresh).map(claim -> save(claim, town, attempt.town()));
            });
  }

  private Change<Claim> save(Claim claim, Town town, Town stored) {
    state().addClaim(claim);
    var levelChanged = town.governorLevel() != stored.governorLevel();
    CompletableFuture<Void> write =
        levelChanged
            ? settling.store().addClaimAndSaveTown(claim, now(), town)
            : settling.store().addClaim(claim, now());
    if (levelChanged) {
      state().replaceTown(town);
    }
    return settling.persist(
        claim, write, Settling.Busy.of(claim), () -> settling.events().landChanged(claim.townId()));
  }

  public Result<Change<Claim>, List<ClaimProblem>> unclaim(UUID player, ChunkPos chunk) {
    return attempt(player, chunk)
        .flatMap(claiming::unclaim)
        .map(
            claim -> {
              return settling.persist(
                  claim,
                  settling.store().removeClaim(claim.chunk()),
                  Settling.Busy.of(claim),
                  () -> {
                    state().removeClaim(claim.chunk());
                    settling.events().landChanged(claim.townId());
                  });
            });
  }

  public Result<Change<Claim>, List<ClaimProblem>> setFlag(
      UUID player, ChunkPos chunk, ClaimFlag flag, boolean on) {
    return attempt(player, chunk)
        .flatMap(attempt -> claiming.setFlag(attempt, flag, on))
        .map(this::replace);
  }

  /** Trusts {@code target} (when {@code on}) on the claim at {@code chunk}, or stops trusting. */
  public Result<Change<Claim>, List<ClaimProblem>> trust(
      UUID player, ChunkPos chunk, PlayerRef target, boolean on) {
    return attempt(player, chunk)
        .flatMap(attempt -> claiming.trust(attempt, target, on))
        .map(this::replace);
  }

  private Change<Claim> replace(Claim claim) {
    return settling.persist(
        claim,
        settling.store().saveClaim(claim),
        Settling.Busy.of(claim),
        () -> state().replaceClaim(claim));
  }

  /**
   * Records {@code level} as the Governor level of {@code player}'s town if they own one and it
   * changed, so its limit holds while they are away. Skipped while the town is busy; the next
   * login, logout or claim records it.
   */
  public void recordGovernorLevel(UUID player, int level) {
    var town = state().townOf(player);
    if (town.isEmpty()
        || !town.get().owner().equals(player)
        || town.get().governorLevel() == level
        || settling.isBusy(Settling.Busy.of(town.get(), Set.of()))) {
      return;
    }
    var updated = town.get().withGovernorLevel(level);
    state().replaceTown(updated);
    var _ =
        settling.persist(
            updated, settling.store().saveTown(updated), Settling.Busy.of(updated, Set.of()));
  }

  /** {@code town} with its owner's live Governor level when they are online. */
  public Town withLiveLevel(Town town) {
    var live = levels.liveLevel(town.owner());
    return live.isPresent() ? town.withGovernorLevel(live.getAsInt()) : town;
  }

  /** The most chunks {@code town} may hold now. */
  public int maxClaims(Town town) {
    return claiming.limits().maxClaims(withLiveLevel(town));
  }

  private Result<ClaimAttempt, List<ClaimProblem>> attempt(UUID player, ChunkPos chunk) {
    if (settling.isPlayerBusy(player) || settling.isChunkBusy(chunk)) {
      return Result.err(List.of(new ClaimProblem.Busy()));
    }
    return Claiming.attempt(player, state().townOf(player), chunk, state());
  }

  private TownsState state() {
    return settling.state();
  }

  private Instant now() {
    return settling.clocks().time().instant();
  }

  /** True while a save is outstanding or the state is being reloaded, for tests and status. */
  public boolean isSettling() {
    return settling.isSettling();
  }
}
