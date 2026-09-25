package com.shepherdjerred.thestorm.towns.domain.claiming;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.ASSISTANT;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_B;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.chunk;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.claim;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import com.shepherdjerred.thestorm.towns.domain.region.BlockCorner;
import com.shepherdjerred.thestorm.towns.domain.region.ChunkCorner;
import com.shepherdjerred.thestorm.towns.domain.region.ChunkRange;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.shepherdjerred.thestorm.towns.domain.region.RegionAreas;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** Claiming, unclaiming and flag changes: adjacency, buffers, regions, worlds, roles, limits. */
final class ClaimingTest {

  private static final ClaimPolicy POLICY =
      new ClaimPolicy(Set.of(Fixtures.WORLD), 2, 5, Set.of(ClaimFlag.PUBLIC_SWITCHES));

  private final Claiming claiming = new Claiming(POLICY);

  /** Spawn covers chunks 100..101 on both axes; a cuboid pokes into chunk (-50, -50) by a block. */
  private final RegionIndex regions =
      new RegionIndex(
          List.of(
              new AdminRegion(
                  "spawn",
                  "Spawn",
                  new RegionAreas(
                      List.of(
                          new ChunkRange(
                              Fixtures.WORLD,
                              new ChunkCorner(100, 100),
                              new ChunkCorner(101, 101))),
                      List.of(
                          new Cuboid(
                              Fixtures.WORLD,
                              new BlockCorner(-801, 0, -801),
                              new BlockCorner(-800, 10, -800)))),
                  List.of())));

  private final Map<ChunkPos, Claim> claims = new HashMap<>();

  private final ClaimMap map =
      new ClaimMap() {
        @Override
        public Optional<Claim> claimAt(ChunkPos chunk) {
          return Optional.ofNullable(claims.get(chunk));
        }

        @Override
        public int claimCount(UUID townId) {
          return (int) claims.values().stream().filter(c -> c.townId().equals(townId)).count();
        }

        @Override
        public Optional<AdminRegion> regionOverlapping(ChunkPos chunk) {
          return regions.overlapping(chunk);
        }
      };

  private void hold(Claim claim) {
    claims.put(claim.chunk(), claim);
  }

  private Result<Claim, List<ClaimProblem>> claimAs(UUID player, Town town, ChunkPos chunk) {
    return claiming.claim(new ClaimAttempt(player, town, chunk, map));
  }

  private static List<ClaimProblem> problems(Result<?, List<ClaimProblem>> result) {
    return result.fold(ok -> List.of(), errors -> errors);
  }

  @Test
  void aTownsFirstClaimMayBeAnywhereAndGetsTheDefaultFlags() {
    var result = claimAs(OWNER, Fixtures.townA(), chunk(7, -3));

    assertThat(result)
        .isEqualTo(
            Result.ok(
                new Claim(
                    chunk(7, -3), TOWN_A, new ClaimFlags(Set.of(ClaimFlag.PUBLIC_SWITCHES)))));
  }

  @ParameterizedTest(name = "({0}, {1}) next to (0, 0)")
  @CsvSource({"1, 0", "-1, 0", "0, 1", "0, -1"})
  void laterClaimsMayShareAnEdge(int x, int z) {
    hold(claim(TOWN_A, 0, 0));

    assertThat(claimAs(OWNER, Fixtures.townA(), chunk(x, z)).isOk()).isTrue();
  }

  @ParameterizedTest(name = "({0}, {1}) is not adjacent to (0, 0)")
  @CsvSource({"1, 1", "-1, -1", "1, -1", "-1, 1", "2, 0", "0, -2", "5, 5"})
  void cornersAndGapsDoNotCountAsAdjacent(int x, int z) {
    hold(claim(TOWN_A, 0, 0));

    assertThat(problems(claimAs(OWNER, Fixtures.townA(), chunk(x, z))))
        .containsExactly(new ClaimProblem.NotAdjacent());
  }

  @Test
  void adjacencyCountsOnlyTheTownsOwnClaims() {
    hold(claim(TOWN_A, 0, 0));
    hold(claim(TOWN_B, 10, 0));

    assertThat(problems(claimAs(OWNER, Fixtures.townA(), chunk(20, 0))))
        .containsExactly(new ClaimProblem.NotAdjacent());
  }

  @Test
  void adjacencyIsPerWorld() {
    hold(new Claim(new ChunkPos("world_nether", 1, 0), TOWN_A, ClaimFlags.none()));

    assertThat(problems(claimAs(OWNER, Fixtures.townA(), chunk(0, 0))))
        .containsExactly(new ClaimProblem.NotAdjacent());
  }

  @ParameterizedTest(name = "town B at ({0}, {1}) is within the buffer of (0, 0)")
  @CsvSource({"2, 0", "0, -2", "2, 2", "-2, 1", "1, 1"})
  void anotherTownWithinTheBufferBlocksTheClaim(int x, int z) {
    hold(claim(TOWN_B, x, z));

    assertThat(problems(claimAs(OWNER, Fixtures.townA(), chunk(0, 0))))
        .containsExactly(new ClaimProblem.TooCloseToTown(TOWN_B, 2));
  }

  @ParameterizedTest(name = "town B at ({0}, {1}) is outside the buffer of (0, 0)")
  @CsvSource({"3, 0", "0, -3", "3, 3", "-3, 2"})
  void anotherTownJustOutsideTheBufferDoesNot(int x, int z) {
    hold(claim(TOWN_B, x, z));

    assertThat(claimAs(OWNER, Fixtures.townA(), chunk(0, 0)).isOk()).isTrue();
  }

  @Test
  void theTownsOwnClaimsNeverCountAgainstTheBuffer() {
    hold(claim(TOWN_A, 0, 0));
    hold(claim(TOWN_A, 1, 1));

    assertThat(claimAs(OWNER, Fixtures.townA(), chunk(1, 0)).isOk()).isTrue();
  }

  @Test
  void aZeroBufferLetsTownsTouch() {
    hold(claim(TOWN_B, 0, 0));

    var touching =
        new Claiming(new ClaimPolicy(Set.of(Fixtures.WORLD), 0, 5, Set.of()))
            .claim(new ClaimAttempt(OWNER, Fixtures.townA(), chunk(1, 0), map));

    assertThat(touching.isOk()).isTrue();
  }

  @ParameterizedTest(name = "({0}, {1}) overlaps spawn")
  @CsvSource({"100, 100", "101, 100", "100, 101", "101, 101", "-51, -51", "-50, -50"})
  void chunksARegionOverlapsCannotBeClaimed(int x, int z) {
    assertThat(problems(claimAs(OWNER, Fixtures.townA(), chunk(x, z))))
        .containsExactly(new ClaimProblem.InsideRegion("Spawn"));
  }

  @ParameterizedTest(name = "({0}, {1}) is next to spawn")
  @CsvSource({"99, 100", "102, 101", "100, 102", "-52, -51", "-49, -50"})
  void chunksNextToARegionCanBeClaimed(int x, int z) {
    assertThat(claimAs(OWNER, Fixtures.townA(), chunk(x, z)).isOk()).isTrue();
  }

  @Test
  void onlyListedWorldsCanBeClaimed() {
    var result = claimAs(OWNER, Fixtures.townA(), new ChunkPos("world_the_end", 0, 0));

    assertThat(problems(result))
        .containsExactly(new ClaimProblem.WorldNotClaimable("world_the_end"));
  }

  @Test
  void assistantsMayClaimButMembersMayNot() {
    assertThat(claimAs(ASSISTANT, Fixtures.townA(), chunk(0, 0)).isOk()).isTrue();
    assertThat(problems(claimAs(MEMBER, Fixtures.townA(), chunk(0, 0))))
        .containsExactly(new ClaimProblem.CannotManageClaims(TownRole.MEMBER));
  }

  @Test
  void aTownCannotHoldMoreThanTheLimit() {
    for (var x = 0; x < 5; x++) {
      hold(claim(TOWN_A, x, 0));
    }

    assertThat(problems(claimAs(OWNER, Fixtures.townA(), chunk(5, 0))))
        .containsExactly(new ClaimProblem.LimitReached(5));
  }

  @Test
  void theLimitComesFromThePort() {
    var limits = new Claiming(POLICY, town -> town.name().equals("Aegis") ? 1 : 100);
    hold(claim(TOWN_A, 0, 0));

    assertThat(problems(limits.claim(new ClaimAttempt(OWNER, Fixtures.townA(), chunk(1, 0), map))))
        .containsExactly(new ClaimProblem.LimitReached(1));
  }

  @Test
  void aFlatLimitMustAllowAClaim() {
    assertThatThrownBy(() -> ClaimLimits.flat(0)).isInstanceOf(IllegalArgumentException.class);
    assertThat(ClaimLimits.flat(3).maxClaims(Fixtures.townA())).isEqualTo(3);
  }

  @Test
  void aHeldChunkCannotBeClaimedAgain() {
    hold(claim(TOWN_A, 0, 0));

    assertThat(problems(claimAs(OWNER, Fixtures.townA(), chunk(0, 0))))
        .containsExactly(new ClaimProblem.AlreadyClaimed(TOWN_A));
  }

  @Test
  void anotherTownsChunkReportsEveryProblem() {
    hold(claim(TOWN_A, 40, 40));
    hold(claim(TOWN_B, 0, 0));

    assertThat(problems(claimAs(MEMBER, Fixtures.townA(), chunk(0, 0))))
        .containsExactly(
            new ClaimProblem.CannotManageClaims(TownRole.MEMBER),
            new ClaimProblem.AlreadyClaimed(TOWN_B),
            new ClaimProblem.TooCloseToTown(TOWN_B, 2));
  }

  @Test
  void someoneWithoutATownCannotClaim() {
    assertThat(problems(Claiming.attempt(Fixtures.NOMAD, Optional.empty(), chunk(0, 0), map)))
        .containsExactly(new ClaimProblem.NotInTown());
  }

  @Test
  void unclaimingReturnsTheHeldClaim() {
    var held = claim(TOWN_A, 3, 3, ClaimFlag.PVP);
    hold(held);

    assertThat(claiming.unclaim(new ClaimAttempt(ASSISTANT, Fixtures.townA(), chunk(3, 3), map)))
        .isEqualTo(Result.ok(held));
  }

  @Test
  void unclaimingNeedsTheTownsOwnClaimAndAManager() {
    hold(claim(TOWN_B, 0, 0));

    var attempts = new ArrayList<List<ClaimProblem>>();
    attempts.add(
        problems(claiming.unclaim(new ClaimAttempt(OWNER, Fixtures.townA(), chunk(9, 9), map))));
    attempts.add(
        problems(claiming.unclaim(new ClaimAttempt(OWNER, Fixtures.townA(), chunk(0, 0), map))));
    attempts.add(
        problems(claiming.unclaim(new ClaimAttempt(MEMBER, Fixtures.townA(), chunk(0, 0), map))));

    assertThat(attempts)
        .containsExactly(
            List.of(new ClaimProblem.NotClaimed()),
            List.of(new ClaimProblem.OwnedByOtherTown(TOWN_B)),
            List.of(
                new ClaimProblem.CannotManageClaims(TownRole.MEMBER),
                new ClaimProblem.OwnedByOtherTown(TOWN_B)));
  }

  @Test
  void settingAFlagChangesOnlyThatFlag() {
    hold(claim(TOWN_A, 0, 0, ClaimFlag.PUBLIC_SWITCHES));

    var attempt = new ClaimAttempt(OWNER, Fixtures.townA(), chunk(0, 0), map);

    assertThat(claiming.setFlag(attempt, ClaimFlag.PVP, true))
        .isEqualTo(Result.ok(claim(TOWN_A, 0, 0, ClaimFlag.PUBLIC_SWITCHES, ClaimFlag.PVP)));
    assertThat(claiming.setFlag(attempt, ClaimFlag.PUBLIC_SWITCHES, false))
        .isEqualTo(Result.ok(claim(TOWN_A, 0, 0)));
  }

  @Test
  void membersCannotSetFlags() {
    hold(claim(TOWN_A, 0, 0));

    assertThat(
            problems(
                claiming.setFlag(
                    new ClaimAttempt(MEMBER, Fixtures.townA(), chunk(0, 0), map),
                    ClaimFlag.PVP,
                    true)))
        .hasSize(1);
  }
}
