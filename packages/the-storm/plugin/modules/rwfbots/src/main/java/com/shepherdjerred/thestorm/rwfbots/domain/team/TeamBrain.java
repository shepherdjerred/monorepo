package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.random.RandomGenerator;

/**
 * The 1 to 2 Hz team step: forgets dead enemies, re-deals roles every couple of seconds, and picks
 * the round's strategy up front from the team's temperament.
 */
public final class TeamBrain {

  /** How often roles are re-dealt, in ticks. */
  public static final int ROLE_PERIOD_TICKS = 40;

  private TeamBrain() {}

  /**
   * One team's living bots and their personalities' role weights.
   *
   * @param snapshot the world
   * @param bots the living bots on the team
   * @param roleWeights each bot's personality role weights
   */
  public record TeamSituation(
      WorldSnapshot snapshot,
      List<CombatantView> bots,
      Map<CombatantId, Map<Role, Double>> roleWeights) {

    public TeamSituation {
      bots = List.copyOf(bots);
      roleWeights = Map.copyOf(roleWeights);
      for (var bot : bots) {
        if (!roleWeights.containsKey(bot.id())) {
          throw new IllegalArgumentException("no role weights for " + bot.id());
        }
      }
    }

    /** The role weights of {@code bot}, which must be on the team. */
    public Map<Role, Double> weightsOf(CombatantId bot) {
      var weights = roleWeights.get(bot);
      if (weights == null) {
        throw new IllegalArgumentException("no role weights for " + bot);
      }
      return weights;
    }
  }

  /** Advances {@code board} for {@code situation}. */
  public static Blackboard tick(Blackboard board, TeamSituation situation) {
    var snapshot = situation.snapshot();
    var result = board;
    for (var combatant : snapshot.combatants()) {
      if (!combatant.alive()) {
        result = result.forget(combatant.id());
      }
    }
    var alive = situation.bots().stream().filter(CombatantView::alive).toList();
    var due = snapshot.tick() - result.rolesAssignedTick() >= ROLE_PERIOD_TICKS;
    var rosterChanged = !result.roles().keySet().equals(idsOf(alive).keySet());
    if ((due || rosterChanged) && !alive.isEmpty()) {
      var utilities = new HashMap<CombatantId, Map<Role, Double>>();
      for (var bot : alive) {
        utilities.put(bot.id(), RoleUtilities.score(bot, situation.weightsOf(bot.id()), snapshot));
      }
      var roles = RoleAssignment.assign(utilities, result.strategy().slots(alive.size()));
      result = result.withRoles(roles, snapshot.tick());
    }
    return result;
  }

  private static Map<CombatantId, CombatantView> idsOf(List<CombatantView> bots) {
    var map = new HashMap<CombatantId, CombatantView>();
    for (var bot : bots) {
      map.put(bot.id(), bot);
    }
    return map;
  }

  /**
   * The round's strategy for a team whose members average {@code aggression} and {@code patience}
   * (each 0..1): aggressive teams rush or hunt, patient ones turtle, and larger teams split more.
   */
  public static Strategy chooseStrategy(
      double aggression, double patience, int teamSize, RandomGenerator random) {
    var weights = new EnumMap<Strategy, Double>(Strategy.class);
    weights.put(Strategy.RUSH, 0.2 + aggression);
    weights.put(Strategy.SPLIT, teamSize >= 3 ? 0.6 : 0.1);
    weights.put(Strategy.TURTLE, 0.2 + patience);
    weights.put(Strategy.HUNT, 0.1 + aggression * 0.5);
    var total = weights.values().stream().mapToDouble(Double::doubleValue).sum();
    var draw = random.nextDouble() * total;
    for (var entry : weights.entrySet()) {
      draw -= entry.getValue();
      if (draw < 0) {
        return entry.getKey();
      }
    }
    return Strategy.HUNT;
  }
}
