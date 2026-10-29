package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.JumpController;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.Optional;

/**
 * Conservative setup estimates; a future edge inherits the current actor's momentum only when the
 * actor is already running up its line. A leap from the actor's own node is judged where the actor
 * will stand when the plan reaches its reflex, so a body sprinting over a takeoff is never handed
 * that leap just after it ran past the launch window, and sent back for a fresh run-up.
 */
final class LeapPreparation {
  private static final double TURN_AND_ACCELERATE_TICKS = 6;

  /**
   * Ticks a plan made now takes to reach the reflex, with margin. Production bots follow plans a
   * tick or two after their snapshot, up to five ticks old counting the think period between them.
   */
  static final double PLAN_LATENCY_TICKS = 4;

  /**
   * How far behind a run-up start a body running up its line counts as heading into it: a few
   * strides, over which the line still predicts the route. The reflex joins that run-up on the way
   * in, so the leap is planned before the body reaches its takeoff node.
   */
  static final double RUNNING_REACH = 3;

  private LeapPreparation() {}

  static double ticks(NavGraph graph, int edge, CombatantView self, int initialNode) {
    if (!graph.edgeLeaves(edge, initialNode)) {
      var ahead = graph.waypoint(edge).launch().orElseThrow();
      if (JumpController.runningAt(ahead, arriving(self), RUNNING_REACH)) return 0;
      return 2 * graph.runUpDistance(edge) / MovementMotor.SPRINT_SPEED + TURN_AND_ACCELERATE_TICKS;
    }
    var waypoint = graph.waypoint(edge, initialNode);
    var launch = waypoint.launch().orElseThrow();
    var runUp = launch.takeoff().horizontalDistance(launch.runUpStart());
    var request =
        new JumpController.Request(waypoint, new ActiveJump.Intent(Option.HUNT, waypoint.pos()));
    var arriving = arriving(self);
    var entry = JumpController.tick(Optional.empty(), request, arriving, 0);
    if (entry.jump()) return 0;
    // A currently airborne or vertically displaced actor cannot launch yet. This estimate does
    // not certify its eventual landing; the real controller still refuses an invalid entry.
    if (entry.failed()) return 120 + 2 * runUp / MovementMotor.SPRINT_SPEED;
    var stage = entry.state().map(ActiveJump::stage);
    // Already running the line (or joining it): the run-up is under way, not about to begin.
    if (stage.equals(Optional.of(ActiveJump.Stage.RUN_UP))
        || JumpController.joinsRunUp(waypoint, arriving))
      return arriving.pos().horizontalDistance(launch.takeoff()) / MovementMotor.SPRINT_SPEED;
    var approach = arriving.pos().horizontalDistance(entry.moveTo());
    var backsUp = stage.equals(Optional.of(ActiveJump.Stage.BACKUP));
    return (approach + (backsUp ? runUp : 0)) / MovementMotor.SPRINT_SPEED
        + TURN_AND_ACCELERATE_TICKS;
  }

  /** Where a grounded body will stand once a plan made now is followed, at its present pace. */
  private static CombatantView arriving(CombatantView self) {
    if (!self.onGround()) return self;
    return self.withPos(self.pos().plus(self.vel().horizontal().scale(PLAN_LATENCY_TICKS)));
  }
}
