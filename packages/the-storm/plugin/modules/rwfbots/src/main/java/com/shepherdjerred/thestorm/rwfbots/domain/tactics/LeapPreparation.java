package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.JumpController;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.Optional;

/** Conservative setup estimates; future edges never inherit the current actor's momentum. */
final class LeapPreparation {
  private static final double TURN_AND_ACCELERATE_TICKS = 6;

  private LeapPreparation() {}

  static double ticks(NavGraph graph, int edge, CombatantView self, int initialNode) {
    if (!graph.edgeLeaves(edge, initialNode))
      return 2 * graph.runUpDistance(edge) / MovementMotor.SPRINT_SPEED + TURN_AND_ACCELERATE_TICKS;
    var waypoint = graph.waypoint(edge, initialNode);
    var launch = waypoint.launch().orElseThrow();
    var runUp = launch.takeoff().horizontalDistance(launch.runUpStart());
    var request =
        new JumpController.Request(waypoint, new ActiveJump.Intent(Option.HUNT, waypoint.pos()));
    var entry = JumpController.tick(Optional.empty(), request, self, 0);
    if (entry.jump()) return 0;
    // A currently airborne or vertically displaced actor cannot launch yet. This estimate does
    // not certify its eventual landing; the real controller still refuses an invalid entry.
    if (entry.failed()) return 120 + 2 * runUp / MovementMotor.SPRINT_SPEED;
    var approach = self.pos().horizontalDistance(entry.moveTo());
    var backsUp = entry.moveTo().equals(launch.runUpStart());
    return (approach + (backsUp ? runUp : 0)) / MovementMotor.SPRINT_SPEED
        + TURN_AND_ACCELERATE_TICKS;
  }
}
