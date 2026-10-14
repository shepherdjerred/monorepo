package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.WaterIndex;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import org.junit.jupiter.api.Test;

final class FallRiskTest {
  private static NavGraph primitive(Hop hop, boolean liquid, byte halfHeight) {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 2, 10, 1);
    var water =
        liquid
            ? new WaterIndex(
                bounds,
                new int[] {0, 0, 1},
                new WaterIndex.Intervals(new int[] {1}, new int[] {1}, new int[] {0, 1}),
                new WaterIndex.Portals(new int[] {1}, new int[] {1}))
            : WaterIndex.empty(bounds);
    return new NavGraph(
        bounds,
        new NavGraph.NodeData(
            new int[] {bounds.index(0, 8, 0), bounds.index(1, 1, 0)},
            water,
            new byte[] {halfHeight, 0}),
        new NavGraph.Topology(new int[] {0, 1, 1}, new int[] {1}),
        new NavGraph.EdgeData(new byte[] {hop.code()}, new float[] {20}));
  }

  private static NavGraph drop() {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 2, 10, 1);
    return new NavGraph(
        bounds,
        new int[] {bounds.index(0, 8, 0), bounds.index(1, 0, 0)},
        new NavGraph.Topology(new int[] {0, 1, 1}, new int[] {1}),
        new NavGraph.EdgeData(new byte[] {Hop.DROP.code()}, new float[] {20}));
  }

  @Test
  void usesVanillaFallAttributesAndEnchantmentProtectionInsteadOfArmorPoints() {
    assertThat(FallRisk.damage(drop(), 0, TraversalState.UNMODIFIED, 30)).isEqualTo(5);
    var protectedBody =
        new TraversalState(true, 3, 1, 20, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20, 0);
    assertThat(FallRisk.damage(drop(), 0, protectedBody, 30)).isEqualTo(1);
    var custom = new TraversalState(true, 5, 0.5, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20, 0);
    assertThat(FallRisk.damage(drop(), 0, custom, 30)).isEqualTo(2);
  }

  @Test
  void temporaryNoFallResistanceAndJumpBoostMustSurviveUntilLanding() {
    var state = new TraversalState(true, 3, 1, 0, 0, 40, 20, -1, 2, -1, -1, 1, 50, 20, 0);
    assertThat(FallRisk.damage(drop(), 0, state, 19)).isZero();
    assertThat(FallRisk.damage(drop(), 0, state, 30)).isEqualTo(3);
    assertThat(FallRisk.damage(drop(), 0, state, 40)).isEqualTo(3);
    assertThat(FallRisk.damage(drop(), 0, state, 50)).isEqualTo(5);
  }

  @Test
  void healingInTheInventoryDoesNotSpendUnreceivedHealth() {
    var state = new TraversalState(true, 3, 1, 0, -1, -1, -1, -1, 64, 1, 100, -1, -1, 20, 0);
    assertThat(FallRisk.damage(drop(), 0, state, 30)).isEqualTo(5);
  }

  @Test
  void pendingFallIsIncludedOnceInTheRemainingDropAndCancelledByFluidOrClimbContact() {
    var self =
        combatant(1, RED, new Vec3(0.5, 6, 0.5))
            .withTraversal(TraversalState.UNMODIFIED.withFallDistance(4));
    var landing = new Waypoint(new Vec3(0.5, 2, 0.5), Hop.DROP);
    assertThat(FallRisk.damage(landing, self, 30)).isEqualTo(5);
    assertThat(FallRisk.landingDamage(4, Waypoint.Landing.GROUND, self.traversal(), 30))
        .isEqualTo(5);
    assertThat(FallRisk.landingDamage(4, Waypoint.Landing.WATER, self.traversal(), 30)).isZero();
    assertThat(FallRisk.landingDamage(4, Waypoint.Landing.CLIMB, self.traversal(), 30)).isZero();
    assertThat(FallRisk.landingDamage(4, Waypoint.Landing.GROUND, TraversalState.UNMODIFIED, 30))
        .isEqualTo(1);
  }

  @Test
  void edgeDamageMatchesTheUnchangedEntryGuardAcrossGeometryAndEffectExpiry() {
    for (var hop : List.of(Hop.DROP, Hop.LEAP))
      for (var water : new boolean[] {false, true})
        for (var halfHeight : new byte[] {0, -1})
          assertEntryParity(primitive(hop, water, halfHeight));
  }

  private static void assertEntryParity(NavGraph graph) {
    var point = graph.waypoint(0);
    var states =
        List.of(
            TraversalState.UNMODIFIED,
            new TraversalState(true, 3, 1, 20, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20, 0),
            new TraversalState(true, 5, 0.5, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20, 0),
            new TraversalState(true, 3, 1, 0, 0, 40, 20, 45, 2, -1, -1, 1, 50, 20, 0));
    for (var state : states) {
      var self = combatant(1, RED, graph.feet(0)).withTraversal(state);
      for (var tick : new long[] {19, 20, 39, 40, 44, 45, 49, 50, 100})
        assertThat(FallRisk.damage(graph, 0, state, tick))
            .isEqualTo(FallRisk.damage(point, self, tick));
    }
  }
}
