package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.ApproachNodes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.DistanceField;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class BombScreensTest {
  @Test
  void aOneWayPlatformCannotBecomeAWorkerUnlessSpawnsCanReachIt() {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 2, 5, 2);
    var cells = new int[] {bounds.index(0, 1, 1), bounds.index(0, 2, 1)};
    var graph =
        new NavGraph(
            bounds,
            cells,
            new NavGraph.Topology(new int[] {0, 0, 1}, new int[] {0}),
            new NavGraph.EdgeData(new byte[] {Hop.DROP.code()}, new float[] {5}));
    var sites =
        new NavSites(
            List.of(new NavSites.Site("spawn", Optional.of("red"), new BlockPos(0, 1, 1))),
            List.of(new NavSites.Site("fuse", Optional.of("red"), new BlockPos(0, 1, 0))));
    var fields = Map.of("fuse", new DistanceField(new float[] {0, 5}));
    var empty = new java.util.BitSet();
    var grid = new VoxelGrid(bounds, empty, empty, empty);
    assertThat(ApproachNodes.canInteract(graph, grid, 1, sites.bombs().getFirst().cell())).isTrue();
    var baked = BombScreens.bake(graph, grid, sites, fields);
    assertThat(baked.require("fuse").workers()).containsExactly(0);
    var invalid = new BombScreens(Map.of("fuse", new BombScreens.Layout(List.of(1), List.of(), 0)));
    assertThatThrownBy(() -> invalid.validateCertification(graph, grid, sites, fields))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void observedDoorOcclusionKeepsStaticCertificationButCannotBeBakedAsAnInteractionRay() {
    var nav = SyntheticMap.bake();
    var site = nav.sites().bombs().getFirst();
    var node = nav.bombScreens().require(site.name()).workers().getFirst();
    var door = BlockPos.of(nav.graph().feet(node));
    var closed = nav.grid().withDoorState(door, false);
    assertThat(ApproachNodes.canInteract(nav.graph(), closed, node, site.cell())).isFalse();
    assertThat(nav.withGrid(closed).bombScreens()).isSameAs(nav.bombScreens());
    assertThatThrownBy(
            () ->
                nav.bombScreens()
                    .validateCertification(nav.graph(), closed, nav.sites(), nav.distanceFields()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("interaction ray");
  }

  @Test
  void verticalOneWayScreensAreKeptAndBlockedPlatformsAreExcluded() {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 6, 8, 2);
    var cells = new int[] {bounds.index(0, 1, 1), bounds.index(0, 5, 0), bounds.index(5, 1, 0)};
    var graph =
        new NavGraph(
            bounds,
            cells,
            new NavGraph.Topology(new int[] {0, 0, 1, 1}, new int[] {0}),
            new NavGraph.EdgeData(new byte[] {Hop.DROP.code()}, new float[] {20}));
    var sites =
        new NavSites(
            List.of(),
            List.of(new NavSites.Site("fuse", Optional.of("red"), new BlockPos(0, 1, 0))));
    var fields = Map.of("fuse", new DistanceField(new float[] {0, 20, Float.POSITIVE_INFINITY}));
    var empty = new java.util.BitSet();
    var grid = new VoxelGrid(bounds, empty, empty, empty);
    var formation = BombScreens.bake(graph, grid, sites, fields).require("fuse");
    assertThat(formation.workers()).containsExactly(0);
    assertThat(formation.screens()).containsExactly(1);
    assertThat(formation.spaciousScreens()).isEqualTo(1);
  }

  @Test
  void formationsAreDeterministicBoundedReachableAndSpacingValidated() {
    var nav = SyntheticMap.bake();
    var first = BombScreens.bake(nav.graph(), nav.grid(), nav.sites(), nav.distanceFields());
    var again = BombScreens.bake(nav.graph(), nav.grid(), nav.sites(), nav.distanceFields());
    assertThat(first).isEqualTo(again);
    first.validateCertification(nav.graph(), nav.grid(), nav.sites(), nav.distanceFields());
    for (var site : nav.sites().bombs()) {
      var layout = first.require(site.name());
      assertThat(layout.workers()).hasSizeBetween(1, BombScreens.MAX_WORKERS);
      assertThat(layout.screens()).hasSizeLessThanOrEqualTo(BombScreens.MAX_SCREENS);
      assertThat(layout.spaciousScreens()).isGreaterThan(0);
      var field = java.util.Objects.requireNonNull(nav.distanceFields().get(site.name()));
      assertThat(layout.workers())
          .allSatisfy(
              node -> {
                assertThat(field.reachable(node)).isTrue();
                assertThat(ApproachNodes.canInteract(nav.graph(), nav.grid(), node, site.cell()))
                    .isTrue();
              });
      assertThat(layout.screens()).doesNotHaveDuplicates();
    }
  }

  @Test
  void malformedOrMissingBakedFactsAreRejected() {
    assertThatThrownBy(() -> new BombScreens.Layout(List.of(1), List.of(1), 1))
        .isInstanceOf(IllegalArgumentException.class);
    var nav = SyntheticMap.bake();
    var diagnostic = new java.util.HashMap<>(nav.bombScreens().sites());
    diagnostic.put(
        nav.sites().bombs().getFirst().name(), new BombScreens.Layout(List.of(), List.of(), 0));
    var unplayable = new BombScreens(diagnostic);
    unplayable.validate(nav.graph(), nav.sites(), nav.distanceFields());
    assertThatThrownBy(
            () ->
                unplayable.validateCertification(
                    nav.graph(), nav.grid(), nav.sites(), nav.distanceFields()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("no reachable certified fuse worker");
    assertThatThrownBy(
            () ->
                new BombScreens(Map.of()).validate(nav.graph(), nav.sites(), nav.distanceFields()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> BombScreens.bake(nav.graph(), nav.grid(), nav.sites(), Map.of()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("distance field");
  }
}
