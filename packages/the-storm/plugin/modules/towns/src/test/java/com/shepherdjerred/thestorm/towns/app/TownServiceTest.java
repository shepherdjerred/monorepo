package com.shepherdjerred.thestorm.towns.app;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.ASSISTANT;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.chunk;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.claim;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimAllowance;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimPolicy;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.claiming.Claiming;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
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

  private final FakeTownsStore store = new FakeTownsStore();
  private final TownsState state = new TownsState(new RegionIndex(List.of()));
  private final List<Throwable> reloadFailures = new ArrayList<>();

  /** Governor levels of the players the test has put online. */
  private final Map<UUID, Integer> online = new HashMap<>();

  private final Settling settling =
      new Settling(
          state,
          store,
          new Clocks(
              InstantSource.fixed(NOW),
              new SplittableRandom(1),
              Runnable::run,
              reloadFailures::add),
          TownEvents.NONE);

  private final TownService service =
      new TownService(
          settling,
          new Claiming(
              new ClaimPolicy(
                  Set.of(Fixtures.WORLD),
                  2,
                  new ClaimAllowance(10, List.of(1, 2, 3, 4, 5)),
                  Set.of())),
          player ->
              online.containsKey(player)
                  ? OptionalInt.of(online.get(player))
                  : OptionalInt.empty());

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

    assertThat(service.found(MEMBER, "Carthage", 1))
        .isEqualTo(Result.err(List.of(new TownProblem.Busy())));

    store.fail();

    assertThat(state.townOf(MEMBER)).contains(Fixtures.townA());
    assertThat(state.claimAt(chunk(0, 0))).contains(claim(TOWN_A, 0, 0));
    assertThat(service.found(MEMBER, "Carthage", 1).isOk()).isFalse();
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
    var town = ok(service.found(NOMAD, "Carthage", 1));
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
    assertThat(service.found(NOMAD, "Carthage", 1))
        .isEqualTo(Result.err(List.of(new TownProblem.Busy())));

    store.finishReload();
    assertThat(service.isSettling()).isFalse();
    assertThat(service.found(NOMAD, "Carthage", 1).isOk()).isTrue();
  }

  @Test
  void aFailedReloadIsReportedAndKeepsRefusing() {
    ok(service.claim(OWNER, chunk(1, 0)));
    store.failAndHoldReload();

    store.failReload();

    assertThat(reloadFailures).hasSize(1);
    assertThat(service.found(NOMAD, "Carthage", 1).isOk()).isFalse();
  }

  @Test
  void refusalsExplainThemselves() {
    assertThat(service.claim(NOMAD, chunk(5, 5)))
        .isEqualTo(Result.err(List.of(new ClaimProblem.NotInTown())));
    assertThat(service.found(OWNER, "Other", 1).isOk()).isFalse();
    assertThat(service.disband(MEMBER, "Aegis").isOk()).isFalse();
  }

  @Test
  void aClaimRecordsTheOwnersLiveGovernorLevel() {
    online.put(OWNER, 3);

    ok(service.claim(OWNER, chunk(1, 0)));
    store.succeedAll();

    assertThat(state.town(TOWN_A).orElseThrow().governorLevel()).isEqualTo(3);
    assertThat(store.snapshot().towns()).extracting(Town::governorLevel).containsExactly(3);
  }

  @Test
  void theStoredLevelHoldsWhileTheOwnerIsAway() {
    state.replaceTown(Fixtures.townA().withGovernorLevel(2));
    for (var x = 1; x < 12; x++) {
      state.addClaim(claim(TOWN_A, x, 0));
    }

    assertThat(service.claim(ASSISTANT, chunk(12, 0)))
        .isEqualTo(Result.err(List.of(new ClaimProblem.LimitReached(12))));
    assertThat(service.maxClaims(state.town(TOWN_A).orElseThrow())).isEqualTo(12);

    online.put(OWNER, 5);
    assertThat(service.maxClaims(state.town(TOWN_A).orElseThrow())).isEqualTo(15);
    ok(service.claim(ASSISTANT, chunk(12, 0)));
  }

  @Test
  void aLowerLiveLevelShrinksTheLimitForNewClaimsOnly() {
    state.replaceTown(Fixtures.townA().withGovernorLevel(5));
    for (var x = 1; x < 12; x++) {
      state.addClaim(claim(TOWN_A, x, 0));
    }
    online.put(OWNER, 0);

    assertThat(service.claim(OWNER, chunk(12, 0)))
        .isEqualTo(Result.err(List.of(new ClaimProblem.LimitReached(10))));
    assertThat(state.claimCount(TOWN_A)).isEqualTo(12);
  }

  @Test
  void ownersLevelsAreRecordedWhenTheyComeAndGo() {
    service.recordGovernorLevel(OWNER, 4);
    assertThat(state.town(TOWN_A).orElseThrow().governorLevel()).isEqualTo(4);
    store.succeed();
    assertThat(store.snapshot().towns()).extracting(Town::governorLevel).containsExactly(4);

    service.recordGovernorLevel(OWNER, 4);
    service.recordGovernorLevel(MEMBER, 1);
    service.recordGovernorLevel(NOMAD, 5);
    assertThat(store.pending()).isZero();
    assertThat(state.town(TOWN_A).orElseThrow().governorLevel()).isEqualTo(4);
  }

  @Test
  void aFoundedTownStartsWithItsFoundersLevel() {
    var town = ok(service.found(NOMAD, "Carthage", 3));

    assertThat(town.governorLevel()).isEqualTo(3);
  }

  @Test
  void claimTrustIsSavedAndUndoneLikeAnyChange() {
    var nomad = new PlayerRef(NOMAD, "Nomad");

    var trusted = ok(service.trust(OWNER, chunk(0, 0), nomad, true));
    assertThat(trusted.trusted()).containsExactly(NOMAD);
    assertThat(state.claimAt(chunk(0, 0))).contains(trusted);
    store.succeed();
    assertThat(store.snapshot().claims()).contains(trusted);

    ok(service.trust(ASSISTANT, chunk(0, 0), nomad, false));
    store.fail();
    assertThat(state.claimAt(chunk(0, 0)).orElseThrow().trusted()).containsExactly(NOMAD);
  }

  @Test
  void membersCannotTrustAndMembersNeedNoTrust() {
    var nomad = new PlayerRef(NOMAD, "Nomad");
    var owner = new PlayerRef(ASSISTANT, "Assistant");

    assertThat(service.trust(MEMBER, chunk(0, 0), nomad, true))
        .isEqualTo(Result.err(List.of(new ClaimProblem.CannotManageClaims(TownRole.MEMBER))));
    assertThat(service.trust(OWNER, chunk(0, 0), owner, true))
        .isEqualTo(Result.err(List.of(new ClaimProblem.TrustsMember("Assistant"))));
    assertThat(service.trust(OWNER, chunk(0, 0), nomad, false))
        .isEqualTo(Result.err(List.of(new ClaimProblem.NotTrusted("Nomad"))));
    assertThat(service.trust(OWNER, chunk(5, 5), nomad, true))
        .isEqualTo(Result.err(List.of(new ClaimProblem.NotClaimed())));
  }
}
