package com.shepherdjerred.thestorm.towns.app;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.ASSISTANT;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OTHER_TOWN_OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_B;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.claim;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.TrustLevel;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The in-memory index: resolving land, invariants, and trust from membership. */
final class TownsStateTest {

  /** Fixtures' test region covers chunks -2..1 on both axes. */
  private final TownsState state =
      new TownsState(new RegionIndex(List.of(Fixtures.region("spawn"))));

  @BeforeEach
  void load() {
    state.load(
        new TownsSnapshot(
            List.of(Fixtures.townA(), Fixtures.townB()),
            List.of(claim(TOWN_A, 10, 10, ClaimFlag.PVP), claim(TOWN_B, 20, 20))));
  }

  @Test
  void positionsResolveToRegionClaimOrWilderness() {
    assertThat(state.landAt("world", 0, 64, 0)).isInstanceOf(Land.RegionLand.class);
    assertThat(state.landAt("world", 160, 64, 175))
        .isEqualTo(new Land.TownLand(claim(TOWN_A, 10, 10, ClaimFlag.PVP)));
    assertThat(state.landAt("world", 159, 64, 160)).isEqualTo(new Land.Wilderness());
    assertThat(state.landAt("world_nether", 160, 64, 160)).isEqualTo(new Land.Wilderness());
  }

  @Test
  void regionsWinOverClaims() {
    state.addClaim(claim(TOWN_A, 0, 0));

    assertThat(state.landAt("world", 1, 64, 1)).isInstanceOf(Land.RegionLand.class);
  }

  @Test
  void trustComesFromMembership() {
    assertThat(state.trustOf(OWNER, TOWN_A)).isEqualTo(TrustLevel.OWNER);
    assertThat(state.trustOf(ASSISTANT, TOWN_A)).isEqualTo(TrustLevel.TRUSTED);
    assertThat(state.trustOf(OTHER_TOWN_OWNER, TOWN_A)).isEqualTo(TrustLevel.OUTSIDER);
    assertThat(state.trustOf(NOMAD, TOWN_A)).isEqualTo(TrustLevel.OUTSIDER);
    assertThatThrownBy(() -> state.trustOf(OWNER, UUID.randomUUID()))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void townsAreFoundByMemberAndByNameIgnoringCase() {
    assertThat(state.townOf(ASSISTANT)).contains(Fixtures.townA());
    assertThat(state.townOf(NOMAD)).isEmpty();
    assertThat(state.named("AEGIS")).contains(Fixtures.townA());
    assertThat(state.named("Carthage")).isEmpty();
  }

  @Test
  void claimsAreCountedPerTown() {
    state.addClaim(claim(TOWN_A, 11, 10));

    assertThat(state.claimCount(TOWN_A)).isEqualTo(2);
    assertThat(state.claimCount(TOWN_B)).isEqualTo(1);
    assertThat(state.claimsOf(TOWN_A)).hasSize(2);
    state.removeClaim(Fixtures.chunk(11, 10));
    state.removeClaim(Fixtures.chunk(10, 10));
    assertThat(state.claimCount(TOWN_A)).isZero();
    assertThat(state.removeClaim(Fixtures.chunk(10, 10))).isEmpty();
  }

  @Test
  void removingATownReleasesItsClaimsAndMembers() {
    var released = state.removeTown(TOWN_A);

    assertThat(released).containsExactly(claim(TOWN_A, 10, 10, ClaimFlag.PVP));
    assertThat(state.landAt("world", 160, 64, 160)).isEqualTo(new Land.Wilderness());
    assertThat(state.townOf(OWNER)).isEmpty();
    assertThat(state.named("Aegis")).isEmpty();
    assertThat(state.claimCount(TOWN_A)).isZero();
    assertThat(state.removeTown(TOWN_A)).isEmpty();
  }

  @Test
  void replacingAClaimChangesItsFlags() {
    state.replaceClaim(claim(TOWN_A, 10, 10));

    assertThat(state.claimAt(Fixtures.chunk(10, 10))).contains(claim(TOWN_A, 10, 10));
    assertThatThrownBy(() -> state.replaceClaim(claim(TOWN_B, 10, 10)))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> state.replaceClaim(claim(TOWN_A, 50, 50)))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void reloadingReplacesEverything() {
    state.addClaim(claim(TOWN_A, 11, 10));

    state.reload(new TownsSnapshot(List.of(Fixtures.townB()), List.of(claim(TOWN_B, 20, 20))));

    assertThat(state.townOf(OWNER)).isEmpty();
    assertThat(state.named("Aegis")).isEmpty();
    assertThat(state.claimAt(Fixtures.chunk(10, 10))).isEmpty();
    assertThat(state.claimCount(TOWN_A)).isZero();
    assertThat(state.claimCount(TOWN_B)).isEqualTo(1);
    assertThat(state.townOf(OTHER_TOWN_OWNER)).contains(Fixtures.townB());
  }

  @Test
  void invariantsAreEnforced() {
    assertThatThrownBy(() -> state.addClaim(claim(TOWN_B, 10, 10)))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> state.addClaim(claim(UUID.randomUUID(), 0, 50)))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
            () -> state.addTown(Town.found(UUID.randomUUID(), "aegis", Fixtures.FOUNDED, NOMAD)))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
            () -> state.addTown(Town.found(UUID.randomUUID(), "Carthage", Fixtures.FOUNDED, OWNER)))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> state.addTown(Fixtures.townA()))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> state.load(new TownsSnapshot(List.of(), List.of())))
        .isInstanceOf(IllegalStateException.class);
  }
}
