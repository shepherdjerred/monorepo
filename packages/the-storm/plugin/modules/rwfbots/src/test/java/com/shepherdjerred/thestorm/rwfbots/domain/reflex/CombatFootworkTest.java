package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.BitSet;
import org.junit.jupiter.api.Test;

final class CombatFootworkTest {
  private static final GridBounds BOUNDS = new GridBounds(new BlockPos(0, 0, 0), 12, 8, 12);
  private static final Vec3 EAST = new Vec3(1, 0, 0);
  private static final Vec3 SOUTH = new Vec3(0, 0, 1);

  private static CombatantView self() {
    return Fixtures.combatant(1, Fixtures.RED, new Vec3(5.5, 1, 5.5));
  }

  private static BitSet floor() {
    var blocks = new BitSet(BOUNDS.volume());
    for (var x = 0; x < 12; x++) {
      for (var z = 0; z < 12; z++) blocks.set(BOUNDS.index(x, 0, z));
    }
    return blocks;
  }

  private static VoxelGrid grid(BitSet blocks) {
    return new VoxelGrid(BOUNDS, blocks, new BitSet(), new BitSet());
  }

  @Test
  void aDodgeAvoidsHeadHeightCollisionEvenWhenItsFeetAndRayAreClear() {
    var blocks = floor();
    blocks.set(BOUNDS.index(5, 2, 6));
    assertThat(CombatFootwork.steer(grid(blocks), self(), SOUTH, EAST)).isEqualTo(EAST);
  }

  @Test
  void unplannedDodgesDoNotStepOffALedgeButAirborneSteeringRemainsAvailable() {
    var blocks = floor();
    blocks.clear(BOUNDS.index(5, 0, 6));
    assertThat(CombatFootwork.steer(grid(blocks), self(), SOUTH, EAST)).isEqualTo(EAST);
    assertThat(CombatFootwork.safe(grid(blocks), self().withMotion(true, false), SOUTH)).isTrue();
  }

  @Test
  void aBlockedDodgeAndApproachStopWithoutRepeatedWallPressure() {
    var blocks = floor();
    blocks.set(BOUNDS.index(5, 1, 6));
    blocks.set(BOUNDS.index(6, 1, 5));
    assertThat(CombatFootwork.steer(grid(blocks), self(), SOUTH, EAST)).isEqualTo(Vec3.ZERO);
    assertThat(CombatFootwork.safe(grid(floor()), self(), SOUTH)).isTrue();
  }
}
