package com.shepherdjerred.thestorm.towns.domain.lock;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OTHER_TOWN_OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_B;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/** Who may lock, unlock, trust, open and break, and when items may move. */
final class LockRulesTest {

  private static final BlockPos LEFT = new BlockPos("world", 0, 64, 0);
  private static final BlockPos RIGHT = new BlockPos("world", 1, 64, 0);
  private static final UUID NEW_ID = UUID.fromString("00000000-0000-4000-8000-0000000000aa");
  private static final LockPolicy POLICY = new LockPolicy(3, true);
  private static final LockAttempt.Ground OPEN = LockAttempt.Ground.OPEN;

  private final Map<BlockPos, Lock> locks = new HashMap<>();
  private final LockIndex index =
      new LockIndex() {
        @Override
        public Optional<Lock> lockAt(BlockPos block) {
          return Optional.ofNullable(locks.get(block));
        }

        @Override
        public int countOf(UUID owner) {
          return (int)
              locks.values().stream().filter(lock -> lock.owner().equals(owner)).distinct().count();
        }
      };

  private static LockAttempt attempt(UUID player, LockAttempt.Standing standing) {
    return new LockAttempt(player, List.of(LEFT, RIGHT), standing, NEW_ID);
  }

  private static List<LockProblem> problems(Result<Lock, List<LockProblem>> result) {
    return result.fold(lock -> List.of(), problems -> problems);
  }

  private void hold(Lock lock) {
    lock.blocks().forEach(block -> locks.put(block, lock));
  }

  @Test
  void aPlayerLocksWhatTheyPlaced() {
    var result =
        LockRules.lock(
            attempt(OWNER, new LockAttempt.Standing(OWNER, true, OPEN, false)), index, POLICY);

    assertThat(result).isEqualTo(Result.ok(Lock.of(NEW_ID, OWNER, Set.of(LEFT, RIGHT))));
  }

  /** Who placed it (nobody recorded, the player, someone else) against whether they may build. */
  static Stream<Arguments> placements() {
    return Stream.of(
        Arguments.of("unrecorded, may build", null, true, List.of()),
        Arguments.of(
            "unrecorded, may not build", null, false, List.of(new LockProblem.NotYourLand())),
        Arguments.of("own, may build", "self", true, List.of()),
        Arguments.of("own, may not build", "self", false, List.of(new LockProblem.NotYourLand())),
        Arguments.of(
            "someone else's, may build",
            "other",
            true,
            List.of(new LockProblem.PlacedBySomeoneElse())),
        Arguments.of(
            "someone else's, may not build",
            "other",
            false,
            List.of(new LockProblem.PlacedBySomeoneElse())));
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("placements")
  void onlyThePlacerLocksAndOnlyWhereTheyMayBuild(
      String name, String placer, boolean mayBuild, List<LockProblem> expected) {
    var placedBy = placer == null ? null : placer.equals("self") ? OWNER : OTHER_TOWN_OWNER;
    var standing = new LockAttempt.Standing(placedBy, mayBuild, OPEN, false);

    assertThat(problems(LockRules.lock(attempt(OWNER, standing), index, POLICY)))
        .isEqualTo(expected);
  }

  @Test
  void staffLockAnything() {
    var standing = new LockAttempt.Standing(OTHER_TOWN_OWNER, false, OPEN, true);

    assertThat(LockRules.lock(attempt(NOMAD, standing), index, POLICY).isOk()).isTrue();
  }

  @Test
  void aLockedContainerCannotBeLockedAgain() {
    hold(Lock.of(UUID.randomUUID(), OWNER, Set.of(RIGHT)));
    var standing = new LockAttempt.Standing(null, true, OPEN, false);

    assertThat(problems(LockRules.lock(attempt(OWNER, standing), index, POLICY)))
        .containsExactly(new LockProblem.AlreadyLocked(true));
    assertThat(problems(LockRules.lock(attempt(NOMAD, standing), index, POLICY)))
        .containsExactly(new LockProblem.AlreadyLocked(false));
  }

  @Test
  void theLimitCountsEachLockOnce() {
    for (var x = 10; x < 13; x++) {
      hold(Lock.of(UUID.randomUUID(), OWNER, Set.of(new BlockPos("world", x, 64, 0))));
    }

    assertThat(
            problems(
                LockRules.lock(
                    attempt(OWNER, new LockAttempt.Standing(OWNER, true, OPEN, false)),
                    index,
                    POLICY)))
        .containsExactly(new LockProblem.LimitReached(3));
  }

  @Test
  void everyProblemIsReportedAtOnce() {
    for (var x = 10; x < 13; x++) {
      hold(Lock.of(UUID.randomUUID(), NOMAD, Set.of(new BlockPos("world", x, 64, 0))));
    }
    hold(Lock.of(UUID.randomUUID(), OWNER, Set.of(LEFT)));

    assertThat(
            problems(
                LockRules.lock(
                    attempt(NOMAD, new LockAttempt.Standing(OWNER, true, OPEN, false)),
                    index,
                    POLICY)))
        .containsExactly(
            new LockProblem.AlreadyLocked(false),
            new LockProblem.PlacedBySomeoneElse(),
            new LockProblem.LimitReached(3));
  }

  @Test
  void onlyTheOwnerOrStaffUnlocks() {
    var lock = Lock.of(NEW_ID, OWNER, Set.of(LEFT)).withTrust(MEMBER, LockGrant.MANAGE);

    assertThat(LockRules.unlock(Optional.of(lock), true)).isEqualTo(Result.ok(lock));
    assertThat(problems(LockRules.unlock(Optional.of(lock), false)))
        .containsExactly(new LockProblem.NotYourLock());
    assertThat(problems(LockRules.unlock(Optional.empty(), true)))
        .containsExactly(new LockProblem.NotLocked());
  }

  @Test
  void onlyTheOwnerChangesWhoIsTrusted() {
    var lock = Lock.of(NEW_ID, OWNER, Set.of(LEFT));
    var nomad = new PlayerRef(NOMAD, "Nomad");

    var trusted = LockRules.trust(OWNER, Optional.of(lock), nomad, Optional.of(LockGrant.USE));
    assertThat(trusted).isEqualTo(Result.ok(lock.withTrust(NOMAD, LockGrant.USE)));
    assertThat(
            problems(
                LockRules.trust(
                    OWNER,
                    Optional.of(lock.withTrust(NOMAD, LockGrant.USE)),
                    nomad,
                    Optional.of(LockGrant.USE))))
        .containsExactly(new LockProblem.AlreadyTrusted("Nomad"));
    assertThat(problems(LockRules.trust(OWNER, Optional.of(lock), nomad, Optional.empty())))
        .containsExactly(new LockProblem.NotTrusted("Nomad"));
    assertThat(
            problems(LockRules.trust(MEMBER, Optional.of(lock), nomad, Optional.of(LockGrant.USE))))
        .containsExactly(new LockProblem.NotYourLock());
    assertThat(
            problems(
                LockRules.trust(
                    OWNER,
                    Optional.of(lock),
                    new PlayerRef(OWNER, "Me"),
                    Optional.of(LockGrant.USE))))
        .containsExactly(new LockProblem.NotYourself());
    assertThat(
            problems(LockRules.trust(OWNER, Optional.empty(), nomad, Optional.of(LockGrant.USE))))
        .containsExactly(new LockProblem.NotLocked());
  }

  @Test
  void ownerCanUpgradeTrustAndChooseTownAndRedstoneOptions() {
    var lock = Lock.of(NEW_ID, OWNER, Set.of(LEFT));
    var nomad = new PlayerRef(NOMAD, "Nomad");
    var upgraded =
        LockRules.trust(
            OWNER,
            Optional.of(lock.withTrust(NOMAD, LockGrant.USE)),
            nomad,
            Optional.of(LockGrant.MANAGE));
    assertThat(upgraded).isEqualTo(Result.ok(lock.withTrust(NOMAD, LockGrant.MANAGE)));
    assertThat(LockRules.shareWithTown(OWNER, Optional.of(lock), true))
        .isEqualTo(Result.ok(lock.withOptions(new Lock.Options(true, false))));
    assertThat(LockRules.redstone(OWNER, Optional.of(lock), true))
        .isEqualTo(Result.ok(lock.withOptions(new Lock.Options(false, true))));
    assertThat(problems(LockRules.shareWithTown(MEMBER, Optional.of(lock), true)))
        .containsExactly(new LockProblem.NotYourLock());
    assertThat(problems(LockRules.redstone(MEMBER, Optional.of(lock), true)))
        .containsExactly(new LockProblem.NotYourLock());
  }

  @Test
  void unrecordedContainerOnAnotherTownsClaimCannotBeLocked() {
    var standing = new LockAttempt.Standing(null, true, LockAttempt.Ground.OTHER_CLAIM, false);
    assertThat(problems(LockRules.lock(attempt(OWNER, standing), index, POLICY)))
        .containsExactly(new LockProblem.TownsToLock());
    var managed = new LockAttempt.Standing(null, true, LockAttempt.Ground.MANAGED_CLAIM, false);
    assertThat(LockRules.lock(attempt(OWNER, managed), index, POLICY).isOk()).isTrue();
  }

  private static LockAccess access() {
    var towns = Map.of(OWNER, TOWN_A, MEMBER, TOWN_A, OTHER_TOWN_OWNER, TOWN_B);
    return new LockAccess(
        new LockAccess.Towns() {
          @Override
          public Optional<UUID> townIdOf(UUID player) {
            return Optional.ofNullable(towns.get(player));
          }

          @Override
          public boolean manages(UUID player, UUID townId) {
            return player.equals(OTHER_TOWN_OWNER) && townId.equals(TOWN_B);
          }
        });
  }

  @Test
  void openingBreakingAndUnlockingAreDistinctRights() {
    var lock =
        Lock.of(NEW_ID, OWNER, Set.of(LEFT))
            .withTrust(NOMAD, LockGrant.USE)
            .withTrust(MEMBER, LockGrant.MANAGE)
            .withOptions(new Lock.Options(true, false));
    var access = access();

    assertThat(access.open(lock, OWNER, false, Optional.empty())).contains(LockAccess.Right.OWNER);
    assertThat(access.open(lock, NOMAD, false, Optional.empty()))
        .contains(LockAccess.Right.TRUSTED);
    assertThat(access.breaking(lock, NOMAD, false, Optional.empty())).isEmpty();
    assertThat(access.breaking(lock, MEMBER, false, Optional.empty()))
        .contains(LockAccess.Right.TRUSTED);
    assertThat(access.unlocking(lock, MEMBER, false, Optional.empty())).isEmpty();
    assertThat(access.unlocking(lock, OWNER, false, Optional.empty()))
        .contains(LockAccess.Right.OWNER);
    assertThat(access.open(lock, OTHER_TOWN_OWNER, true, Optional.empty()))
        .contains(LockAccess.Right.BYPASS);
  }

  @Test
  void townSharingOnlyOpensAndLandManagerMayTakeOutsidersLock() {
    var access = access();
    var shared = Lock.of(NEW_ID, OWNER, Set.of(LEFT)).withOptions(new Lock.Options(true, false));
    assertThat(access.open(shared, MEMBER, false, Optional.empty()))
        .contains(LockAccess.Right.TOWN);
    assertThat(access.breaking(shared, MEMBER, false, Optional.empty())).isEmpty();
    assertThat(access.unlocking(shared, MEMBER, false, Optional.empty())).isEmpty();

    assertThat(access.open(shared, OTHER_TOWN_OWNER, false, Optional.of(TOWN_B)))
        .contains(LockAccess.Right.LAND_MANAGER);
    assertThat(access.breaking(shared, OTHER_TOWN_OWNER, false, Optional.of(TOWN_B)))
        .contains(LockAccess.Right.LAND_MANAGER);
    assertThat(access.unlocking(shared, OTHER_TOWN_OWNER, false, Optional.of(TOWN_B)))
        .contains(LockAccess.Right.LAND_MANAGER);
    assertThat(access.unlocking(shared, OTHER_TOWN_OWNER, false, Optional.of(TOWN_A))).isEmpty();
  }

  @Test
  void anOwnerWithoutATownSharesWithNobody() {
    var lock = Lock.of(NEW_ID, NOMAD, Set.of(LEFT)).withOptions(new Lock.Options(true, false));
    var access = access();

    assertThat(access.open(lock, OWNER, false, Optional.empty())).isEmpty();
    assertThat(access.open(lock, NOMAD, false, Optional.empty())).contains(LockAccess.Right.OWNER);
  }

  /** Item moves by the lock owners of their ends; empty is an end nobody locked. */
  static Stream<Arguments> transfers() {
    var mine = Optional.of(OWNER);
    var theirs = Optional.of(NOMAD);
    Optional<UUID> open = Optional.empty();
    return Stream.of(
        Arguments.of("unlocked to unlocked", List.of(open, open), true),
        Arguments.of("locked to unlocked hopper", List.of(mine, open), false),
        Arguments.of("unlocked hopper into locked", List.of(open, mine), false),
        Arguments.of("locked to own locked hopper", List.of(mine, mine), true),
        Arguments.of("locked to someone else's lock", List.of(mine, theirs), false),
        Arguments.of("locked double chest to own hopper", List.of(mine, mine, mine), true),
        Arguments.of("half-locked double chest to own hopper", List.of(mine, open, mine), false),
        Arguments.of("nothing at either end", List.of(), true));
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("transfers")
  void itemsMoveOnlyWithinOneOwnersLocks(String name, List<Optional<UUID>> ends, boolean allowed) {
    assertThat(LockAccess.mayTransfer(ends)).isEqualTo(allowed);
  }

  @Test
  void aLockCoversOneOrTwoBlocksAndNeverTrustsItsOwner() {
    assertThatThrownBy(() -> Lock.of(NEW_ID, OWNER, Set.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> Lock.of(NEW_ID, OWNER, Set.of(LEFT, RIGHT, new BlockPos("world", 2, 64, 0))))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Lock.of(NEW_ID, OWNER, Set.of(LEFT)).withTrust(OWNER, LockGrant.USE))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new LockPolicy(0, true)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new LockAttempt(
                    OWNER, List.of(), new LockAttempt.Standing(null, true, OPEN, false), NEW_ID))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aLockGrowsAndShrinksByHalves() {
    var single = Lock.of(NEW_ID, OWNER, Set.of(LEFT));

    assertThat(single.withBlock(RIGHT).blocks()).containsExactlyInAnyOrder(LEFT, RIGHT);
    assertThat(single.withBlock(RIGHT).withoutBlock(LEFT).blocks()).containsExactly(RIGHT);
    assertThat(single.withTrust(NOMAD, LockGrant.USE).withoutTrust(NOMAD).trusted()).isEmpty();
  }
}
