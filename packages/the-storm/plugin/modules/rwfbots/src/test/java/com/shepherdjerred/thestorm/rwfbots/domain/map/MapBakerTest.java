package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class MapBakerTest {

  private final NavArtifact nav = SyntheticMap.bake();

  @Test
  void aPlayableMapValidates() {
    assertThat(nav.validate()).isEmpty();
    assertThat(nav.blocksSha256()).hasSize(64).isEqualTo(MapBaker.sha256(SyntheticMap.open()));
    assertThat(nav.distanceFields())
        .containsKeys("red-spawn", "blue-spawn", "red-bomb", "blue-bomb");
  }

  @Test
  void digestChangesWithTheBlocks() {
    assertThat(MapBaker.sha256(new SyntheticMap(false))).isNotEqualTo(nav.blocksSha256());
  }

  @Test
  void spawnInsideAWallIsReported() {
    var sites =
        new NavSites(
            List.of(
                new NavSites.Site(
                    "red-spawn", Optional.of("red"), new BlockPos(SyntheticMap.WALL_X, 1, 5))),
            SyntheticMap.sites().bombs());
    var problems = MapBaker.bake("bad", SyntheticMap.open(), sites).validate();
    assertThat(problems).extracting(NavProblem::kind).contains(NavProblem.Kind.SPAWN_NOT_WALKABLE);
  }

  @Test
  void bombBehindASealedDoorIsUnreachable() {
    var problems =
        MapBaker.bake("sealed", new SyntheticMap(false), SyntheticMap.sites()).validate();
    assertThat(problems)
        .extracting(NavProblem::kind)
        .contains(NavProblem.Kind.BOMB_UNREACHABLE)
        .doesNotContain(NavProblem.Kind.SPAWN_NOT_WALKABLE);
    assertThat(problems).anyMatch(p -> p.detail().contains("blue-bomb from red-spawn"));
  }

  @Test
  void missingSitesAreReported() {
    var empty = new NavSites(List.of(), List.of());
    var problems = MapBaker.bake("empty", SyntheticMap.open(), empty).validate();
    assertThat(problems)
        .extracting(NavProblem::kind)
        .containsExactlyInAnyOrder(NavProblem.Kind.NO_SPAWNS, NavProblem.Kind.NO_BOMBS);
  }

  @Test
  void theDoorIsTheBusiestChokepoint() {
    var points = nav.chokepoints().points();
    assertThat(points).isNotEmpty();
    var busiest = points.getFirst();
    var cell = nav.graph().cell(busiest.node());
    assertThat(cell.x()).isEqualTo(SyntheticMap.WALL_X);
    assertThat(busiest.width()).isEqualTo(2);
    // Only the two cross-map pairs (each spawn to the enemy bomb) pass the door.
    assertThat(busiest.routeShare()).isGreaterThanOrEqualTo(0.5);
  }

  @Test
  void regionsOnOppositeSidesOfTheWallCannotSeeEachOther() {
    var regions = nav.regions();
    var west = regions.regionOf(nav.graph().nodeAt(new BlockPos(2, 1, 2)).orElseThrow());
    var east = regions.regionOf(nav.graph().nodeAt(new BlockPos(30, 1, 2)).orElseThrow());
    var westMid = regions.regionOf(nav.graph().nodeAt(new BlockPos(10, 1, 15)).orElseThrow());
    var eastMid = regions.regionOf(nav.graph().nodeAt(new BlockPos(20, 1, 15)).orElseThrow());
    assertThat(regions.canSee(west, east)).isFalse();
    assertThat(regions.canSee(westMid, eastMid)).isTrue();
    assertThat(regions.canSee(west, west)).isTrue();
  }

  @Test
  void coverIsFoundAgainstTheWall() {
    var protectingFromEast =
        nav.cover().protectingFrom(nav.graph(), new Vec3(15.5, 1, 5.5), new Vec3(25.5, 1, 5.5), 2);
    assertThat(protectingFromEast).isNotEmpty();
    assertThat(nav.graph().cell(protectingFromEast.getFirst().node()).x())
        .isEqualTo(SyntheticMap.WALL_X - 1);
  }

  @Test
  void approachRoutesCoverEverySpawnBombPair() {
    assertThat(nav.routes().between("red-spawn", "blue-bomb")).isNotEmpty();
    assertThat(nav.routes().between("blue-spawn", "red-bomb")).isNotEmpty();
    assertThat(nav.routes().routes()).allMatch(route -> route.length() > 0);
  }
}
