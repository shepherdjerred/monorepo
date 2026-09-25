package com.shepherdjerred.thestorm.towns.domain.world;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.chunk;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.claim;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.app.TownsSnapshot;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.Owner;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Land a player has no say over near a chunk, for building withers. */
final class NeighbourhoodTest {

  /** Spawn covers chunks -2..1; town A holds chunk (20, 0). */
  private final TownsState state =
      new TownsState(new RegionIndex(List.of(Fixtures.region("spawn"))));

  NeighbourhoodTest() {
    state.load(
        new TownsSnapshot(
            List.of(Fixtures.townA(), Fixtures.townB()), List.of(claim(TOWN_A, 20, 0))));
  }

  @Test
  void anOutsiderIsStoppedWithinTheRadiusOfAClaim() {
    assertThat(new Neighbourhood(state, state).foreignLandNear(NOMAD, chunk(28, 8), 8))
        .contains(new Owner.OfTown(TOWN_A));
    assertThat(new Neighbourhood(state, state).foreignLandNear(NOMAD, chunk(29, 0), 8)).isEmpty();
  }

  @Test
  void membersMayBuildNearTheirOwnTown() {
    assertThat(new Neighbourhood(state, state).foreignLandNear(MEMBER, chunk(20, 0), 8)).isEmpty();
  }

  @Test
  void adminRegionsCountForEveryone() {
    assertThat(new Neighbourhood(state, state).foreignLandNear(MEMBER, chunk(9, 0), 8))
        .contains(new Owner.OfRegion("spawn"));
    assertThat(new Neighbourhood(state, state).foreignLandNear(NOMAD, chunk(10, 0), 8)).isEmpty();
  }
}
