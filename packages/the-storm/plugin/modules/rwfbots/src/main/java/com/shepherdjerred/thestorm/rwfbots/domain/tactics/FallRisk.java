package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;

/** Conservative vanilla environmental fall damage after actual equipment and timed effects. */
public final class FallRisk {
  private FallRisk() {}

  public static int damage(NavGraph graph, int edge, TraversalState state, long arrivalTick) {
    var hop = graph.edgeHop(edge);
    if (hop != Hop.DROP && hop != Hop.LEAP) return 0;
    var target = graph.feet(graph.edgeTarget(edge));
    var distance =
        Math.max(0, graph.feet(graph.edgeSource(edge)).y() - target.y())
            + (hop == Hop.LEAP ? 1.3 : 0);
    return mitigated(distance, graph.cushions(BlockPos.of(target)), state, arrivalTick);
  }

  /** Rechecks current equipment and effects at the actual entry to a prepared primitive. */
  public static int damage(Waypoint point, CombatantView self, long arrivalTick) {
    if (point.hop() != Hop.DROP && point.hop() != Hop.LEAP) return 0;
    var start =
        point
            .launch()
            .map(launch -> Math.max(self.pos().y(), launch.takeoff().y()))
            .orElseGet(() -> self.pos().y());
    var certified = Math.max(0, start - point.pos().y()) + (point.hop() == Hop.LEAP ? 1.3 : 0);
    var pending = self.traversal().fallDistance() + Math.max(0, self.pos().y() - point.pos().y());
    var distance = Math.max(certified, pending);
    return mitigated(
        distance, point.landing() == Waypoint.Landing.WATER, self.traversal(), arrivalTick);
  }

  /** An actual first landing may occur before a projected WALK, without a new DROP edge. */
  public static int landingDamage(
      double remainingDescent, Waypoint.Landing landing, TraversalState state, long arrivalTick) {
    if (!Double.isFinite(remainingDescent) || remainingDescent < 0)
      throw new IllegalArgumentException("remaining fall descent must be finite and non-negative");
    return mitigated(
        state.fallDistance() + remainingDescent,
        landing == Waypoint.Landing.WATER || landing == Waypoint.Landing.CLIMB,
        state,
        arrivalTick);
  }

  private static int mitigated(
      double distance, boolean water, TraversalState state, long arrivalTick) {
    if (water
        || active(state.noFallUntilTick(), arrivalTick)
        || active(state.slowFallingUntilTick(), arrivalTick)) return 0;
    var allowance =
        state.safeFallDistance()
            + (active(state.jumpBoostUntilTick(), arrivalTick)
                ? state.jumpBoostAmplifier() + 1
                : 0);
    var raw = Math.max(0, Math.ceil((distance - allowance) * state.fallDamageMultiplier()));
    var protection = 1 - state.fallProtectionPoints() * 0.04;
    var resistance =
        active(state.resistanceUntilTick(), arrivalTick)
            ? Math.max(0, 1 - (state.resistanceAmplifier() + 1) * 0.2)
            : 1;
    return (int) Math.ceil(raw * protection * resistance);
  }

  public static boolean active(long untilTick, long arrivalTick) {
    return untilTick == Long.MAX_VALUE || (untilTick != -1 && arrivalTick < untilTick);
  }

  public static boolean expires(TraversalState state, long now) {
    return expires(state.noFallUntilTick(), now)
        || expires(state.slowFallingUntilTick(), now)
        || expires(state.resistanceUntilTick(), now)
        || expires(state.jumpBoostUntilTick(), now);
  }

  private static boolean expires(long untilTick, long now) {
    return untilTick != Long.MAX_VALUE && active(untilTick, now);
  }
}
