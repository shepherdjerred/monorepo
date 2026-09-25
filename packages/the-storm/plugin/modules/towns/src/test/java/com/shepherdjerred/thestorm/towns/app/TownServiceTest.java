package com.shepherdjerred.thestorm.towns.app;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.chunk;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.claim;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimPolicy;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.claiming.Claiming;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The use cases against a store that keeps what was saved and whose writes the test completes by
 * hand, on a direct "main thread", so the immediate change, the busy refusals while a save is
 * outstanding, and the reload from storage after a failed save are all visible.
 */
final class TownServiceTest {

  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00Z");

  private final FakeStore store = new FakeStore();
  private final TownsState state = new TownsState(new RegionIndex(List.of()));
  private final List<Throwable> reloadFailures = new ArrayList<>();
  private final TownService service =
      new TownService(
          state,
          store,
          new Claiming(new ClaimPolicy(Set.of(Fixtures.WORLD), 2, 10, Set.of())),
          new Clocks(
              InstantSource.fixed(NOW),
              new SplittableRandom(1),
              Runnable::run,
              reloadFailures::add));

  @BeforeEach
  void load() {
    store.seed(Fixtures.townA(), claim(TOWN_A, 0, 0));
    state.load(store.snapshot());
  }

  private static <T> T ok(Result<Change<T>, ?> result) {
    return result.fold(
        Change::value,
        problems -> {
          throw new AssertionError("expected success, got " + problems);
        });
  }

  private static <T> CompletableFuture<Void> saved(Result<Change<T>, ?> result) {
    return result.fold(
        Change::saved,
        problems -> {
          throw new AssertionError("expected success, got " + problems);
        });
  }

  @Test
  void aClaimProtectsAtOnceAndStaysWhenSaved() {
    var claim = ok(service.claim(OWNER, chunk(1, 0)));

    assertThat(state.claimAt(chunk(1, 0))).contains(claim);
    store.succeed();
    assertThat(state.claimAt(chunk(1, 0))).contains(claim);
    assertThat(store.snapshot().claims()).contains(claim);
    assertThat(service.isSettling()).isFalse();
  }

  @Test
  void aFailedClaimIsUndoneByReloadingStorage() {
    var saved = saved(service.claim(OWNER, chunk(1, 0)));

    store.fail();

    assertThat(state.claimAt(chunk(1, 0))).isEmpty();
    assertThat(saved).isCompletedExceptionally();
    assertThat(service.isSettling()).isFalse();
  }

  @Test
  void aChunkBeingSavedCannotBeChangedAgain() {
    ok(service.claim(OWNER, chunk(1, 0)));

    assertThat(service.unclaim(OWNER, chunk(1, 0)))
        .isEqualTo(Result.err(List.of(new ClaimProblem.Busy())));

    store.fail();

    assertThat(state.claimAt(chunk(1, 0))).isEmpty();
    assertThat(service.unclaim(OWNER, chunk(1, 0)))
        .isEqualTo(Result.err(List.of(new ClaimProblem.NotClaimed())));
  }

  @Test
  void aTownBeingSavedTakesNoOtherClaims() {
    ok(service.claim(OWNER, chunk(1, 0)));

    assertThat(service.claim(OWNER, chunk(0, 1)))
        .isEqualTo(Result.err(List.of(new ClaimProblem.Busy())));
    store.succeed();
    assertThat(service.claim(OWNER, chunk(0, 1)).isOk()).isTrue();
  }

  @Test
  void aTownBeingDeletedKeepsItsMembersUntilSaved() {
    ok(service.disband(OWNER, "Aegis"));
    assertThat(state.townOf(MEMBER)).isEmpty();

    assertThat(service.found(MEMBER, "Carthage"))
        .isEqualTo(Result.err(List.of(new TownProblem.Busy())));

    store.fail();

    assertThat(state.townOf(MEMBER)).contains(Fixtures.townA());
    assertThat(state.claimAt(chunk(0, 0))).contains(claim(TOWN_A, 0, 0));
    assertThat(service.found(MEMBER, "Carthage").isOk()).isFalse();
  }

  @Test
  void aFailedFlagChangeIsUndone() {
    ok(service.setFlag(OWNER, chunk(0, 0), ClaimFlag.PVP, true));
    assertThat(state.landAt("world", 1, 64, 1))
        .isEqualTo(new Land.TownLand(claim(TOWN_A, 0, 0, ClaimFlag.PVP)));

    store.fail();

    assertThat(state.claimAt(chunk(0, 0))).contains(claim(TOWN_A, 0, 0));
  }

  @Test
  void foundingAndDeletingATown() {
    var town = ok(service.found(NOMAD, "Carthage"));
    store.succeed();

    assertThat(town.members()).containsExactly(Map.entry(NOMAD, TownRole.OWNER));
    assertThat(town.createdAt()).isEqualTo(NOW);
    assertThat(state.townOf(NOMAD)).contains(town);

    ok(service.disband(NOMAD, "carthage"));
    store.succeed();
    assertThat(state.townOf(NOMAD)).isEmpty();
    assertThat(store.snapshot().towns()).containsExactly(Fixtures.townA());
  }

  @Test
  void whileReloadingEverythingIsRefused() {
    ok(service.claim(OWNER, chunk(1, 0)));
    store.failAndHoldReload();

    assertThat(service.claim(OWNER, chunk(5, 5)))
        .isEqualTo(Result.err(List.of(new ClaimProblem.Busy())));
    assertThat(service.found(NOMAD, "Carthage"))
        .isEqualTo(Result.err(List.of(new TownProblem.Busy())));

    store.finishReload();
    assertThat(service.isSettling()).isFalse();
    assertThat(service.found(NOMAD, "Carthage").isOk()).isTrue();
  }

  @Test
  void aFailedReloadIsReportedAndKeepsRefusing() {
    ok(service.claim(OWNER, chunk(1, 0)));
    store.failAndHoldReload();

    store.failReload();

    assertThat(reloadFailures).hasSize(1);
    assertThat(service.found(NOMAD, "Carthage").isOk()).isFalse();
  }

  @Test
  void refusalsExplainThemselves() {
    assertThat(service.claim(NOMAD, chunk(5, 5)))
        .isEqualTo(Result.err(List.of(new ClaimProblem.NotInTown())));
    assertThat(service.found(OWNER, "Other").isOk()).isFalse();
    assertThat(service.disband(MEMBER, "Aegis").isOk()).isFalse();
  }

  /**
   * Keeps saved towns and claims. Each write waits until the test completes it: success applies it
   * to what is saved, failure leaves that untouched. Reloads complete at once unless held.
   */
  private static final class FakeStore implements TownsStore {

    private final Map<UUID, Town> towns = new LinkedHashMap<>();
    private final Map<ChunkPos, Claim> claims = new LinkedHashMap<>();
    private final List<Write> pending = new ArrayList<>();
    private boolean holdReload;
    private CompletableFuture<TownsSnapshot> heldReload = new CompletableFuture<>();

    private record Write(Runnable apply, CompletableFuture<Void> done) {}

    void seed(Town town, Claim claim) {
      towns.put(town.id(), town);
      claims.put(claim.chunk(), claim);
    }

    TownsSnapshot snapshot() {
      return new TownsSnapshot(List.copyOf(towns.values()), List.copyOf(claims.values()));
    }

    private CompletableFuture<Void> record(Runnable apply) {
      var done = new CompletableFuture<Void>();
      pending.add(new Write(apply, done));
      return done;
    }

    void succeed() {
      var write = pending.removeFirst();
      write.apply().run();
      write.done().complete(null);
    }

    void fail() {
      pending.removeFirst().done().completeExceptionally(new IllegalStateException("disk full"));
    }

    void failAndHoldReload() {
      holdReload = true;
      fail();
    }

    void finishReload() {
      heldReload.complete(snapshot());
    }

    void failReload() {
      heldReload.completeExceptionally(new IllegalStateException("database gone"));
    }

    @Override
    public CompletableFuture<TownsSnapshot> loadAll() {
      if (holdReload) {
        heldReload = new CompletableFuture<>();
        return heldReload;
      }
      return CompletableFuture.completedFuture(snapshot());
    }

    @Override
    public CompletableFuture<Void> createTown(Town town) {
      return record(() -> towns.put(town.id(), town));
    }

    @Override
    public CompletableFuture<Void> deleteTown(UUID townId) {
      return record(
          () -> {
            towns.remove(townId);
            var remaining = new HashMap<>(claims);
            remaining.values().removeIf(claim -> claim.townId().equals(townId));
            claims.clear();
            claims.putAll(remaining);
          });
    }

    @Override
    public CompletableFuture<Void> addClaim(Claim claim, Instant at) {
      return record(() -> claims.put(claim.chunk(), claim));
    }

    @Override
    public CompletableFuture<Void> removeClaim(ChunkPos chunk) {
      return record(() -> claims.remove(chunk));
    }

    @Override
    public CompletableFuture<Void> saveFlags(Claim claim) {
      return record(() -> claims.put(claim.chunk(), claim));
    }
  }
}
