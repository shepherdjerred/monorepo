package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/**
 * When a route is over although its goal is out of the body's reach: the bot stands on the node the
 * goal snaps to and no route takes it any closer. A slot point over a ledge or in the air is never
 * within reach of the body, which otherwise stood frozen on that node for its plan's whole life
 * (floating-isles: 13 to 15 seconds at a time, over and over).
 */
final class RouteArrival {

  private RouteArrival() {}

  /**
   * Whether {@code step} has achieved its purpose in {@code situation}: {@link Planner#stepDone},
   * and a route also ends on the node its goal snaps to.
   */
  static boolean stepDone(
      PlanStep step, Situation situation, TacticsContext context, long startedTick) {
    if (step instanceof PlanStep.Route(var goal, var _, var _)
        && atGoalNode(situation, context, goal)) return true;
    return Planner.stepDone(step, situation, startedTick);
  }

  /**
   * Whether a route to {@code goal} has arrived for a settled body (on the ground or in water) that
   * stands on the node the goal snaps to.
   */
  static boolean settledOnGoalNode(Situation situation, TacticsContext context, Vec3 goal) {
    return atGoalNode(situation, context, goal) && Planner.workerSettled(situation, context);
  }

  /**
   * Whether the bot stands on the node a route to {@code goal} ends at, while the goal itself lies
   * further off.
   */
  static boolean atGoalNode(Situation situation, TacticsContext context, Vec3 goal) {
    var graph = context.nav().graph();
    var self = situation.self().pos();
    var from = graph.nearestNode(self);
    if (from.isEmpty() || self.distance(goal) <= Planner.ON_CELL) return false;
    var to = graph.nearestNodeWithin(goal, Planner.SNAP);
    return to.isPresent()
        && to.getAsInt() == from.getAsInt()
        && Planner.onCell(self, graph.feet(from.getAsInt()));
  }
}
