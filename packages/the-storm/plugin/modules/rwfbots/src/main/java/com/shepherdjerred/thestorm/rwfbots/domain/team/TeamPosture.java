package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.random.RandomGenerator;
import java.util.stream.Collectors;

/**
 * The posture a team takes when three or more teams are still alive. Two teams, and poison, press.
 * The smallest team does not hunt "the weakest". If every team waits, the most aggressive one
 * presses. About one bot in four ignores the posture; a team of one follows it.
 */
public final class TeamPosture {

  private TeamPosture() {}

  /**
   * One team's roll, before {@link #settle}.
   *
   * @param team who
   * @param posture what they drew
   * @param aggression the team's mean aggression, 0..1, for the settle tie
   */
  public record Choice(TeamId team, Posture posture, double aggression) {}

  /**
   * A living bot and how eagerly it breaks the plan.
   *
   * @param id who
   * @param aggression 0..1
   */
  public record Fighter(CombatantId id, double aggression) {}

  /**
   * A team's mean temper.
   *
   * @param aggression 0..1
   * @param patience 0..1
   */
  public record Temper(double aggression, double patience) {}

  /**
   * The posture for {@code team}. {@code others} fewer than two, or poison already hurting, is
   * {@link Posture#PRESS}.
   */
  public static Posture roll(
      WorldSnapshot snapshot, TeamId team, Temper temper, RandomGenerator random) {
    var aggression = temper.aggression();
    var patience = temper.patience();
    var counts = counts(snapshot);
    var us = counts.getOrDefault(team, 0);
    var others =
        counts.entrySet().stream()
            .filter(entry -> !entry.getKey().equals(team))
            .map(Map.Entry::getValue)
            .toList();
    if (others.size() < 2 || snapshot.poison().active()) {
      return Posture.PRESS;
    }
    var bothLarge = others.stream().allMatch(count -> count >= Math.max(3, us));
    var wait = bothLarge ? 0.55 + 0.35 * patience : 0.08;
    var hunt = weakest(snapshot, team).isEmpty() ? 0 : 0.35 + 0.25 * (1 - aggression);
    var press = 0.3 + 0.7 * aggression;
    var draw = random.nextDouble() * (wait + hunt + press);
    if (draw < wait) {
      return Posture.WAIT;
    }
    if (draw < wait + hunt) {
      return Posture.HUNT_WEAKEST;
    }
    return Posture.PRESS;
  }

  /**
   * If every choice is {@link Posture#WAIT}, the most aggressive team presses. A tie goes to the
   * lowest team id.
   */
  public static List<Choice> settle(List<Choice> choices) {
    if (choices.isEmpty()
        || choices.stream().anyMatch(choice -> choice.posture() != Posture.WAIT)) {
      return List.copyOf(choices);
    }
    var press =
        choices.stream()
            .max(
                Comparator.comparingDouble(Choice::aggression)
                    .thenComparing(choice -> choice.team().value(), Comparator.reverseOrder()))
            .orElseThrow();
    var settled = new ArrayList<Choice>(choices.size());
    for (var choice : choices) {
      settled.add(
          choice.team().equals(press.team())
              ? new Choice(choice.team(), Posture.PRESS, choice.aggression())
              : choice);
    }
    return List.copyOf(settled);
  }

  /**
   * The unique other team with the strictly smallest living count, when {@code us} is larger than
   * that. Empty on a tie, or when {@code us} is that small.
   */
  public static Optional<TeamId> weakest(WorldSnapshot snapshot, TeamId us) {
    var counts = counts(snapshot);
    var ours = counts.getOrDefault(us, 0);
    var others = counts.entrySet().stream().filter(entry -> !entry.getKey().equals(us)).toList();
    if (others.isEmpty()) {
      return Optional.empty();
    }
    var least = others.stream().mapToInt(Map.Entry::getValue).min().orElseThrow();
    if (ours <= least) {
      return Optional.empty();
    }
    var tied =
        others.stream().filter(entry -> entry.getValue() == least).map(Map.Entry::getKey).toList();
    return tied.size() == 1 ? Optional.of(tied.getFirst()) : Optional.empty();
  }

  /**
   * Who ignores wait and hunt-weakest and chases whoever is nearest. A team of one follows the
   * posture. Otherwise at least one and never everyone, about a quarter, aggressive bots first. The
   * same seed and ids always pick the same bots.
   */
  public static Set<CombatantId> slackers(List<Fighter> living, long seed) {
    if (living.size() < 2) {
      return Set.of();
    }
    var want = (int) Math.min(living.size() - 1, Math.max(1, Math.round(living.size() * 0.25)));
    return living.stream()
        .sorted(
            Comparator.comparingDouble(
                    (Fighter fighter) -> hash01(seed, fighter.id()) - chance(fighter))
                .thenComparing(Fighter::id))
        .limit(want)
        .map(Fighter::id)
        .collect(Collectors.toUnmodifiableSet());
  }

  private static double chance(Fighter fighter) {
    return 0.1 + 0.5 * fighter.aggression();
  }

  /** A stable number in {@code [0, 1)} from {@code seed} and {@code id}. */
  static double hash01(long seed, CombatantId id) {
    var mixed = seed ^ (id.value() * 0x9E3779B97F4A7C15L);
    mixed = (mixed ^ (mixed >>> 30)) * 0xBF58476D1CE4E5B9L;
    mixed = (mixed ^ (mixed >>> 27)) * 0x94D049BB133111EBL;
    mixed = mixed ^ (mixed >>> 31);
    return (mixed >>> 11) * 0x1.0p-53;
  }

  private static Map<TeamId, Integer> counts(WorldSnapshot snapshot) {
    var counts = new HashMap<TeamId, Integer>();
    for (var combatant : snapshot.combatants()) {
      if (combatant.alive()) {
        counts.merge(combatant.team(), 1, Integer::sum);
      }
    }
    return counts;
  }
}
