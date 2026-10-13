package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.HealthRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalCosts;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import java.util.HashSet;
import java.util.OptionalDouble;
import java.util.Set;
import java.util.function.IntToDoubleFunction;

/**
 * Values current health against travel time, known enemy exposure and an actual lit-fuse deadline.
 */
public final class TraversalRisk {
  private TraversalRisk() {}

  public record Query(
      HealthRoutes.RiskPolicy policy,
      HealthRoutes.EdgePolicy edges,
      IntToDoubleFunction exposure,
      boolean sprint) {}

  public static Query assess(
      Situation situation, TacticsContext context, Vec3 goal, Stance stance) {
    var graph = context.nav().graph();
    var enemies = situation.knownEnemies();
    var pressure =
        enemies.stream()
            .filter(
                enemy ->
                    enemy.confidence() >= 0.4 && enemy.pos().distance(situation.self().pos()) <= 18)
            .count();
    var deadline = deadline(situation, goal);
    var urgency = urgency(situation, context, deadline);
    var reserve = urgency >= 0.5 ? 1 : 1 + Math.min(4, pressure);
    var available = situation.self().effectiveHealth();
    var capabilities = situation.self().traversal();
    var healingValue =
        (capabilities.healingConsumables() > 0 ? 0.85 : 1)
            * (FallRisk.active(capabilities.regenerationUntilTick(), situation.now()) ? 0.8 : 1);
    var healthValue =
        20
            * (1.5 - context.style().risk())
            * (1 + 2 * Math.max(0, capabilities.maxHealth() - available) / capabilities.maxHealth())
            * (1 + pressure * 0.5)
            * (1 - 0.9 * urgency)
            * healingValue;
    var policy =
        new HealthRoutes.RiskPolicy(Math.max(0, available - reserve), healthValue, deadline);
    var watchers = new HashSet<Integer>();
    for (var enemy : enemies)
      if (enemy.confidence() >= 0.4)
        graph
            .nearestNode(enemy.pos())
            .ifPresent(node -> watchers.add(context.nav().regions().regionOf(node)));
    var exposure = exposure(context, watchers, situation.self(), urgency);
    var sprint =
        capabilities.maySprint() && (stance == Stance.AGGRESSIVE || stance == Stance.EVASIVE);
    var slowFalling = FallRisk.active(capabilities.slowFallingUntilTick(), situation.now());
    var movement =
        new Movement(situation, sprint, graph.nearestNode(situation.self().pos()).orElse(-1));
    var motion =
        new NavGraph.EdgeMotion(
            edge -> duration(graph, movement, edge),
            edge -> graph.edgeHop(edge) != Hop.LEAP || (capabilities.maySprint() && !slowFalling),
            sprint ? 0.76 : 1);
    HealthRoutes.DamageAt damage =
        (edge, elapsed) ->
            FallRisk.damage(graph, edge, capabilities, arrivalTick(situation.now(), elapsed));
    return new Query(
        policy,
        new HealthRoutes.EdgePolicy(
            damage, motion, FallRisk.expires(capabilities, situation.now())),
        exposure,
        sprint);
  }

  private static long arrivalTick(long now, double elapsed) {
    if (elapsed >= (double) (Long.MAX_VALUE - now - 2)) return Long.MAX_VALUE;
    return now + (long) Math.ceil(elapsed) + 2;
  }

  private record Movement(Situation situation, boolean sprint, int initialNode) {}

  private static double duration(NavGraph graph, Movement movement, int edge) {
    var situation = movement.situation();
    var sprint = movement.sprint();
    var cost = graph.edgeCost(edge);
    if (graph.edgeHop(edge) == Hop.DROP
        && FallRisk.active(situation.self().traversal().slowFallingUntilTick(), situation.now())) {
      var depth = graph.cell(graph.edgeSource(edge)).y() - graph.cell(graph.edgeTarget(edge)).y();
      cost = TraversalCosts.slowDrop(Math.max(1, depth));
    }
    if (sprint && graph.edgeHop(edge) == Hop.WALK)
      return cost * MovementMotor.WALK_SPEED / MovementMotor.SPRINT_SPEED;
    if (sprint && graph.edgeHop(edge) == Hop.DROP)
      return cost - TraversalCosts.WALK + 1 / MovementMotor.SPRINT_SPEED;
    if (graph.edgeHop(edge) == Hop.LEAP)
      return cost + LeapPreparation.ticks(graph, edge, situation.self(), movement.initialNode());
    return cost;
  }

  private static IntToDoubleFunction exposure(
      TacticsContext context, Set<Integer> watchers, CombatantView self, double urgency) {
    var regions = context.nav().regions();
    var deficit = Math.max(0, 0.6 * self.traversal().maxHealth() - self.effectiveHealth());
    var cost =
        TraversalCosts.walkingTicks(1 + deficit / (self.traversal().maxHealth() * 0.15))
            * (1 - 0.7 * urgency);
    return node -> cost * regions.exposure(regions.regionOf(node), watchers);
  }

  private static OptionalDouble deadline(Situation situation, Vec3 goal) {
    var bomb = situation.litOwnBomb().filter(target -> target.pos().distance(goal) <= 6);
    if (bomb.isEmpty()) return OptionalDouble.empty();
    var ticks =
        switch (bomb.orElseThrow().state()) {
          // Nine seconds after our first click; kit fuse bonuses can only shorten this bound.
          case BombState.Armed(var remaining) -> remaining - 180;
          case BombState.Defusing(var progress, var clickers, var remaining) ->
              remaining - (long) Math.ceil(Math.max(0, 10 - clickers) * 20 * (1 - progress));
          default -> throw new IllegalStateException("lit fuse has no deadline");
        };
    return OptionalDouble.of((double) Math.max(0, ticks - 1));
  }

  private static double urgency(
      Situation situation, TacticsContext context, OptionalDouble deadline) {
    if (deadline.isEmpty()) return 0;
    var from = context.nav().graph().nearestNode(situation.self().pos());
    var bomb = situation.litOwnBomb().orElseThrow();
    var site =
        context.nav().sites().bombs().stream()
            .filter(candidate -> candidate.cell().center().distance(bomb.pos()) <= 0.1)
            .findFirst();
    if (from.isEmpty()) return 1;
    if (site.isEmpty()) throw new IllegalStateException("lit bomb has no baked site");
    var eta = context.nav().distanceTo(site.orElseThrow().name()).at(from.orElseThrow());
    return Math.clamp((eta + 100 - deadline.orElseThrow()) / 100, 0, 1);
  }
}
