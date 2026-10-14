package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import java.util.BitSet;
import org.junit.jupiter.api.Test;

final class WalkSeparationSupportTest {
  private static final GridBounds BOUNDS = new GridBounds(new BlockPos(0, 0, 0), 8, 4, 8);
  private static final Vec3 HEADING = new Vec3(1, 0, 1).normalized();

  private static VoxelGrid wall(boolean missingClippedFloor) {
    var solid = new BitSet(BOUNDS.volume());
    for (var x = 0; x < 8; x++) for (var z = 0; z < 8; z++) solid.set(BOUNDS.index(x, 0, z));
    for (var y = 1; y <= 2; y++) for (var z = 0; z < 8; z++) solid.set(BOUNDS.index(4, y, z));
    if (missingClippedFloor) solid.clear(BOUNDS.index(3, 0, 4));
    return new VoxelGrid(BOUNDS, solid, solid, solid);
  }

  @Test
  void supportedGroundSeparationKeepsTheNativeWallSlidingInput() {
    var grid = wall(false);
    var self = combatant(1, RED, new Vec3(3.5, 1, 3.5));
    assertThat(CombatFootwork.safe(grid, self, HEADING)).isFalse();
    assertThat(WalkSteering.separate(grid, self, HEADING))
        .isEqualTo(new BodyCommand.MoveToward(self.pos().plus(HEADING), false));
  }

  @Test
  void aSupportedDiagonalDestinationCannotHideAnUnsupportedWallClippedAxis() {
    var grid = wall(true);
    var self = combatant(1, RED, new Vec3(3.5, 1, 3.5));
    assertThat(grid.blocks(4, 0, 4, VoxelGrid.Layer.MOVEMENT)).isTrue();
    assertThat(WalkSteering.separate(grid, self, HEADING)).isEqualTo(new BodyCommand.Stop());
  }

  @Test
  void unknownOutsideBoundsIsNeverTreatedAsSupportingGround() {
    var self = combatant(1, RED, new Vec3(0.5, 1, 0.5));
    assertThat(WalkSteering.separate(wall(false), self, new Vec3(-1, 0, 0)))
        .isEqualTo(new BodyCommand.Stop());
  }

  @Test
  void fractionalSlabFeetKeepTheirExactHeightAndGroundLayer() {
    var self = combatant(1, RED, new Vec3(1.5, 0.5, 1.5));
    assertThat(WalkSteering.separate(wall(false), self, new Vec3(1, 0, 0)))
        .isEqualTo(new BodyCommand.MoveToward(new Vec3(2.5, 0.5, 1.5), false));
  }

  @Test
  void airborneSeparationRetainsTheExistingCapsuleGuard() {
    var self = combatant(1, RED, new Vec3(3.5, 1, 3.5)).withMotion(false, false);
    assertThat(WalkSteering.separate(wall(false), self, HEADING)).isEqualTo(new BodyCommand.Stop());
  }
}
