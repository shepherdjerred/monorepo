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
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The use cases against a store whose writes the test completes by hand, on a direct "main thread",
 * so both the immediate memory change and the rollback after a failed write are visible.
 */
final class TownServiceTest {

  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00Z");

  private final FakeStore store = new FakeStore();
  private final TownsState state = new TownsState(new RegionIndex(List.of()));
  private final TownService service =
      new TownService(
          state,
          store,
          new Claiming(new ClaimPolicy(Set.of(Fixtures.WORLD), 2, 10, Set.of())),
          new Clocks(InstantSource.fixed(NOW), new SplittableRandom(1), Runnable::run));

  @BeforeEach
  void load() {
    state.load(new TownsSnapshot(List.of(Fixtures.townA()), List.of(claim(TOWN_A, 0, 0))));
  }

  private static <T> T ok(Result<Change<T>, ?> result) {
    return result.fold(
        Change::value,
        problems -> {
          throw new AssertionError("expected success, got " + problems);
        });
  }

  @Test
  void aClaimProtectsAtOnceAndStaysWhenSaved() {
    var result = service.claim(OWNER, chunk(1, 0));

    var claim = ok(result);
    assertThat(state.claimAt(chunk(1, 0))).contains(claim);
    store.succeed();
    assertThat(state.claimAt(chunk(1, 0))).contains(claim);
    assertThat(store.writes).containsExactly("addClaim " + chunk(1, 0) + " at " + NOW);
  }

  @Test
  void aClaimIsUndoneWhenSavingFails() {
    var result = service.claim(OWNER, chunk(1, 0));
    var saved =
        result.fold(Change::saved, problems -> CompletableFuture.<Void>completedFuture(null));

    store.fail();

    assertThat(state.claimAt(chunk(1, 0))).isEmpty();
    assertThat(saved).isCompletedExceptionally();
  }

  @Test
  void aRefusedClaimChangesNothing() {
    var result = service.claim(MEMBER, chunk(1, 0));

    assertThat(result.isOk()).isFalse();
    assertThat(state.claimAt(chunk(1, 0))).isEmpty();
    assertThat(store.writes).isEmpty();
  }

  @Test
  void anUnclaimIsUndoneWhenSavingFails() {
    ok(service.unclaim(OWNER, chunk(0, 0)));
    assertThat(state.claimAt(chunk(0, 0))).isEmpty();

    store.fail();

    assertThat(state.claimAt(chunk(0, 0))).contains(claim(TOWN_A, 0, 0));
  }

  @Test
  void aFlagChangeIsUndoneWhenSavingFails() {
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

    assertThat(town.members()).containsExactly(java.util.Map.entry(NOMAD, TownRole.OWNER));
    assertThat(town.createdAt()).isEqualTo(NOW);
    assertThat(state.townOf(NOMAD)).contains(town);

    ok(service.disband(NOMAD, "carthage"));
    store.succeed();
    assertThat(state.townOf(NOMAD)).isEmpty();
  }

  @Test
  void aFailedFoundingIsUndone() {
    ok(service.found(NOMAD, "Carthage"));

    store.fail();

    assertThat(state.townOf(NOMAD)).isEmpty();
    assertThat(state.named("Carthage")).isEmpty();
  }

  @Test
  void aFailedDeletionRestoresTheTownAndItsClaims() {
    ok(service.disband(OWNER, "Aegis"));
    assertThat(state.claimAt(chunk(0, 0))).isEmpty();

    store.fail();

    assertThat(state.townOf(OWNER)).contains(Fixtures.townA());
    assertThat(state.claimAt(chunk(0, 0))).contains(claim(TOWN_A, 0, 0));
  }

  @Test
  void rollbackNeverOverwritesALaterChange() {
    ok(service.claim(OWNER, chunk(1, 0)));
    ok(service.unclaim(OWNER, chunk(1, 0)));
    ok(service.claim(OWNER, chunk(0, 1)));

    store.fail();

    assertThat(state.claimAt(chunk(1, 0))).isEmpty();
    assertThat(state.claimAt(chunk(0, 1))).isPresent();
  }

  @Test
  void refusalsExplainThemselves() {
    assertThat(service.claim(NOMAD, chunk(5, 5)))
        .isEqualTo(Result.err(List.of(new ClaimProblem.NotInTown())));
    assertThat(service.found(OWNER, "Other").isOk()).isFalse();
    assertThat(service.disband(MEMBER, "Aegis").isOk()).isFalse();
  }

  /** Records writes and leaves them pending until the test completes the oldest one. */
  private static final class FakeStore implements TownsStore {

    final List<String> writes = new ArrayList<>();
    private final List<CompletableFuture<Void>> pending = new ArrayList<>();

    private CompletableFuture<Void> record(String write) {
      writes.add(write);
      var future = new CompletableFuture<Void>();
      pending.add(future);
      return future;
    }

    void succeed() {
      pending.removeFirst().complete(null);
    }

    void fail() {
      pending.removeFirst().completeExceptionally(new IllegalStateException("disk full"));
    }

    @Override
    public CompletableFuture<TownsSnapshot> loadAll() {
      throw new UnsupportedOperationException();
    }

    @Override
    public CompletableFuture<Void> createTown(Town town) {
      return record("createTown " + town.name());
    }

    @Override
    public CompletableFuture<Void> deleteTown(UUID townId) {
      return record("deleteTown " + townId);
    }

    @Override
    public CompletableFuture<Void> addClaim(Claim claim, Instant at) {
      return record("addClaim " + claim.chunk() + " at " + at);
    }

    @Override
    public CompletableFuture<Void> removeClaim(ChunkPos chunk) {
      return record("removeClaim " + chunk);
    }

    @Override
    public CompletableFuture<Void> saveFlags(Claim claim) {
      return record("saveFlags " + claim.chunk());
    }
  }
}
