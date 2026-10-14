package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.FallRisk;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import java.util.List;
import org.junit.jupiter.api.Test;

final class FullHeightDropsTest {
  private record Course(int height, boolean water) implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 0, 0), 2, height + 3, 1);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (y == 0 || (x == 0 && y <= height)) return BlockShape.FULL;
      return water && x == 1 && y == 1 ? BlockShape.LIQUID : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }

    NavArtifact bake() {
      return MapBaker.bake("tall-drop", this, new NavSites(List.of(), List.of()));
    }
  }

  private static java.util.Optional<HealthRoutes.Route> route(
      NavArtifact nav, double health, TraversalState state) {
    var graph = nav.graph();
    var from = graph.nodeCount() - 1;
    var to = 0;
    return HealthRoutes.find(
        graph,
        new HealthRoutes.Request(from, to, health - 1, node -> 0),
        edge -> FallRisk.damage(graph, edge, state, 1000));
  }

  @Test
  void aTwentyFourBlockDropIsIntentionalAtThirtyHealthAndRejectedAtTwenty() {
    var nav = new Course(24, false).bake();
    var juggernaut = new TraversalState(false, 3, 1, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 30, 0);
    assertThat(route(nav, 30, juggernaut).orElseThrow().damage()).isEqualTo(21);
    assertThat(route(nav, 20, TraversalState.UNMODIFIED)).isEmpty();
  }

  @Test
  void fullAuthoredHeightAndWideDamageSurviveTheCodecWithoutWrapping() {
    var nav = new Course(340, false).bake();
    var back =
        switch (NavCodec.decode(NavCodec.encode(nav))) {
          case Result.Ok(var value) -> value;
          case Result.Err(var error) -> throw new IllegalStateException(error.message());
        };
    assertThat(back).isEqualTo(nav);
    var graph = back.graph();
    var edge = graph.edgeStart(graph.nodeCount() - 1);
    assertThat(graph.edgeDamage(edge)).isEqualTo(337);
    assertThat(graph.edgeData().capabilities().overflow().edges()).containsExactly(edge);
    assertThat(route(back, 20, TraversalState.UNMODIFIED)).isEmpty();
    var immune =
        new TraversalState(true, 3, 1, 0, -1, -1, Long.MAX_VALUE, -1, 0, -1, -1, -1, -1, 20, 0);
    assertThat(route(back, 20, immune).orElseThrow().damage()).isZero();
    assertThat(
            route(new Course(340, true).bake(), 20, TraversalState.UNMODIFIED)
                .orElseThrow()
                .damage())
        .isZero();
  }

  @Test
  void corruptWideDamageCannotNameAnUnsaturatedOrMissingEdge() {
    assertThatThrownBy(
            () ->
                new EdgeCapabilities(
                    new byte[] {0},
                    new DamageOverflow(new int[] {0}, new int[] {300}),
                    LaunchData.standard(new byte[] {0})))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new DamageOverflow(new int[] {0}, new int[] {255}))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
