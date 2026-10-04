package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.EnumMap;
import java.util.Map;

/** How much one bot wants each role right now: its personality's weights bent by the situation. */
public final class RoleUtilities {

  private static final double PLANT_RANGE = 100;

  private RoleUtilities() {}

  /** What about the situation bends the weights. */
  private record Inputs(
      double health,
      int allies,
      double enemyBombDistance,
      boolean ownBombLit,
      boolean hasOwnBomb,
      boolean hasBow) {

    static Inputs of(CombatantView bot, WorldSnapshot snapshot) {
      var team = bot.team();
      return new Inputs(
          bot.effectiveHealth() / CombatantView.MAX_HEALTH,
          snapshot.alive(team).size(),
          snapshot.bombsArmableBy(team).stream()
              .mapToDouble(bomb -> bomb.pos().distance(bot.pos()))
              .min()
              .orElse(PLANT_RANGE),
          snapshot.bombsOf(team).stream().anyMatch(bomb -> bomb.state().isLit()),
          !snapshot.bombsOf(team).isEmpty(),
          bot.kit().hasBow());
    }
  }

  /**
   * The utility of every role for {@code bot}.
   *
   * @param bot the bot
   * @param weights the personality's role weights
   * @param snapshot the world
   */
  public static Map<Role, Double> score(
      CombatantView bot, Map<Role, Double> weights, WorldSnapshot snapshot) {
    var inputs = Inputs.of(bot, snapshot);
    var scores = new EnumMap<Role, Double>(Role.class);
    for (var role : Role.values()) {
      scores.put(role, weights.getOrDefault(role, 0.0) * situational(role, inputs));
    }
    return scores;
  }

  private static double situational(Role role, Inputs in) {
    return switch (role) {
      case PLANT ->
          (1 - Math.min(1, in.enemyBombDistance() / PLANT_RANGE)) * (0.5 + in.health() / 2);
      case ESCORT -> in.allies() > 1 ? 1 : 0;
      case DEFEND -> in.hasOwnBomb() ? 1 : 0;
      case ROTATE -> 0.5;
      case RETAKE -> in.ownBombLit() ? 1.5 : 0.2;
      case HUNT -> in.hasBow() ? 0.7 : 1;
    };
  }
}
