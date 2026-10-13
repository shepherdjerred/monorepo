package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.map.DistanceField;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/** Choose among a strategy's objectives by baked directed travel cost, with stable commitments. */
final class ObjectiveChoice {
  private ObjectiveChoice() {}

  private record Candidate(BombView bomb, int priority, double cost) {}

  static Optional<BombView> choose(
      Blackboard board, TeamBrain.TeamSituation situation, List<CombatantView> alive) {
    var graph = situation.nav().graph();
    var sources =
        alive.stream()
            .map(bot -> graph.nearestNodeWithin(bot.pos(), 2))
            .filter(java.util.OptionalInt::isPresent)
            .mapToInt(java.util.OptionalInt::getAsInt)
            .toArray();
    if (sources.length == 0) return Optional.empty();
    var candidates =
        situation.snapshot().bombsArmableBy(board.team()).stream()
            .map(
                bomb ->
                    new Candidate(
                        bomb,
                        priority(board.strategy(), bomb),
                        median(field(situation.nav(), bomb), sources)))
            .filter(candidate -> Double.isFinite(candidate.cost()))
            .sorted(
                Comparator.comparingInt(Candidate::priority)
                    .thenComparingDouble(Candidate::cost)
                    .thenComparing(candidate -> candidate.bomb().id()))
            .toList();
    if (candidates.isEmpty()) return Optional.empty();
    var best = candidates.getFirst();
    var committed =
        candidates.stream()
            .filter(
                candidate ->
                    board.plan().objective().filter(candidate.bomb().id()::equals).isPresent())
            .findFirst();
    return Optional.of(
        committed
            .filter(
                candidate ->
                    candidate.priority() == best.priority()
                        && candidate.cost() <= best.cost() * 1.25)
            .orElse(best)
            .bomb());
  }

  private static int priority(Strategy strategy, BombView bomb) {
    var seeksNuke = strategy == Strategy.HUNT || strategy == Strategy.TURTLE;
    return seeksNuke == (bomb.owner() instanceof BombOwner.Nuke) ? 0 : 1;
  }

  private static double median(DistanceField field, int[] sources) {
    var costs = new double[sources.length];
    for (var i = 0; i < sources.length; i++) costs[i] = field.at(sources[i]);
    Arrays.sort(costs);
    return costs[costs.length / 2];
  }

  static DistanceField field(NavArtifact nav, BombView bomb) {
    var site =
        nav.sites().bombs().stream()
            .filter(candidate -> candidate.cell().center().distance(bomb.pos()) < 0.01)
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("live bomb has no baked site"));
    var field = nav.distanceFields().get(site.name());
    if (field == null) throw new IllegalStateException("bomb has no baked directed distance field");
    return field;
  }
}
