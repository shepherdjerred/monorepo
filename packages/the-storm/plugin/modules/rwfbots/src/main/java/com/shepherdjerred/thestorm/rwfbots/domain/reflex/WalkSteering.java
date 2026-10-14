package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;

/** Terrain guards for optional separation; authored traversal keeps its own controller. */
final class WalkSteering {
  private WalkSteering() {}

  /**
   * Ground separation retains native wall sliding only where every clipped axis stays supported.
   */
  static BodyCommand separate(VoxelGrid grid, CombatantView self, Vec3 push) {
    if (push.isZero()) return new BodyCommand.Stop();
    if (!self.onGround()) return makeRoom(grid, self, push);
    var heading = push.normalized();
    return supportedSlide(grid, self.pos(), heading)
        ? new BodyCommand.MoveToward(self.pos().plus(heading), false)
        : new BodyCommand.Stop();
  }

  private static boolean supportedSlide(VoxelGrid grid, Vec3 from, Vec3 heading) {
    var to = from.plus(heading);
    var floor = (int) Math.floor(from.y() - 0.1);
    for (var x = (int) Math.floor(Math.min(from.x(), to.x()));
        x <= (int) Math.floor(Math.max(from.x(), to.x()));
        x++) {
      for (var z = (int) Math.floor(Math.min(from.z(), to.z()));
          z <= (int) Math.floor(Math.max(from.z(), to.z()));
          z++) {
        if (!grid.bounds().contains(x, floor, z)
            || !grid.blocks(x, floor, z, VoxelGrid.Layer.MOVEMENT)) return false;
      }
    }
    return true;
  }

  static Vec3 destination(VoxelGrid grid, CombatantView self, Waypoint waypoint, Vec3 candidate) {
    if (waypoint.hop() != Hop.WALK || candidate.equals(waypoint.pos())) return candidate;
    return CombatFootwork.safe(grid, self, candidate.minus(self.pos()))
        ? candidate
        : waypoint.pos();
  }

  static BodyCommand makeRoom(VoxelGrid grid, CombatantView self, Vec3 push) {
    return push.isZero() || !CombatFootwork.safe(grid, self, push)
        ? new BodyCommand.Stop()
        : new BodyCommand.MoveToward(self.pos().plus(push.normalized()), false);
  }
}
