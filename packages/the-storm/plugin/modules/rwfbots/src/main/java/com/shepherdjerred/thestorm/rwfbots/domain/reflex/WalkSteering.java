package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;

/** Terrain guards for optional walking separation; authored traversal keeps its own controller. */
final class WalkSteering {
  private WalkSteering() {}

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
