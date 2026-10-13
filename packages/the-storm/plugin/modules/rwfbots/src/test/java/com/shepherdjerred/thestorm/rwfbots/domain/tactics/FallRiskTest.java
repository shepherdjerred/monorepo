package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import org.junit.jupiter.api.Test;

final class FallRiskTest {
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
    var protectedBody = new TraversalState(true, 3, 1, 20, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20);
    assertThat(FallRisk.damage(drop(), 0, protectedBody, 30)).isEqualTo(1);
    var custom = new TraversalState(true, 5, 0.5, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20);
    assertThat(FallRisk.damage(drop(), 0, custom, 30)).isEqualTo(2);
  }

  @Test
  void temporaryNoFallResistanceAndJumpBoostMustSurviveUntilLanding() {
    var state = new TraversalState(true, 3, 1, 0, 0, 40, 20, -1, 2, -1, -1, 1, 50, 20);
    assertThat(FallRisk.damage(drop(), 0, state, 19)).isZero();
    assertThat(FallRisk.damage(drop(), 0, state, 30)).isEqualTo(3);
    assertThat(FallRisk.damage(drop(), 0, state, 40)).isEqualTo(3);
    assertThat(FallRisk.damage(drop(), 0, state, 50)).isEqualTo(5);
  }

  @Test
  void healingInTheInventoryDoesNotSpendUnreceivedHealth() {
    var state = new TraversalState(true, 3, 1, 0, -1, -1, -1, -1, 64, 1, 100, -1, -1, 20);
    assertThat(FallRisk.damage(drop(), 0, state, 30)).isEqualTo(5);
  }
}
