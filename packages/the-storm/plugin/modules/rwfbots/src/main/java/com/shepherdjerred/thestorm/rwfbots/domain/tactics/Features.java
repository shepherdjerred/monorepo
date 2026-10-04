package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.List;

/**
 * The numbers the utility curves read, computed once per think.
 *
 * @param healthFrac effective health over max, may exceed one with absorption
 * @param nearestEnemyDistance distance to the nearest known enemy, or infinity
 * @param nearestEnemyConfidence how sure the bot is of that enemy, 0 when none
 * @param visibleEnemies enemies seen this tick
 * @param knownEnemies enemies known at all
 * @param livingAllies teammates alive besides the bot
 * @param livingEnemies enemies alive in truth, which the scoreboard shows
 * @param ownBombLit whether an own bomb's fuse is lit
 * @param ownBombDistance distance to the nearest own bomb, or infinity
 * @param enemyBombDistance distance to the nearest armable bomb, or infinity
 * @param allyArming whether a teammate is arming right now
 * @param enemyNearOwnBomb whether a known enemy is within reach of an own bomb
 * @param poisonActive whether poison has started
 * @param poisonIntensity how hard it hits
 * @param inOwnBombPoisonZone whether the bot stands in the extra-damage radius of its own bomb
 * @param hasGapples whether the kit can heal
 * @param hasRewind whether the kit can rewind
 */
public record Features(
    double healthFrac,
    double nearestEnemyDistance,
    double nearestEnemyConfidence,
    int visibleEnemies,
    int knownEnemies,
    int livingAllies,
    int livingEnemies,
    boolean ownBombLit,
    double ownBombDistance,
    double enemyBombDistance,
    boolean allyArming,
    boolean enemyNearOwnBomb,
    boolean poisonActive,
    double poisonIntensity,
    boolean inOwnBombPoisonZone,
    boolean hasGapples,
    boolean hasRewind) {

  /** How close a known enemy must be to an own bomb to count as threatening it. */
  public static final double BOMB_THREAT_RANGE = 12;

  public static Features of(Situation situation, TacticsContext context) {
    var self = situation.self();
    var enemies = situation.knownEnemies();
    var nearest = enemies.isEmpty() ? null : enemies.getFirst();
    var ownBomb = situation.nearestOwnBomb();
    var poison = situation.snapshot().poison();
    var ownBombDistance =
        ownBomb.map(bomb -> bomb.pos().distance(self.pos())).orElse(Double.POSITIVE_INFINITY);
    var threatened =
        situation.ownBombs().stream()
            .anyMatch(
                bomb ->
                    enemies.stream()
                            .anyMatch(
                                enemy -> enemy.pos().distance(bomb.pos()) <= BOMB_THREAT_RANGE)
                        || bomb.state() instanceof BombState.Arming);
    return new Features(
        self.effectiveHealth() / CombatantView.MAX_HEALTH,
        nearest == null ? Double.POSITIVE_INFINITY : nearest.pos().distance(self.pos()),
        nearest == null ? 0 : nearest.confidence(),
        (int) enemies.stream().filter(Situation.KnownEnemy::visible).count(),
        enemies.size(),
        situation.livingAllies().size(),
        situation.snapshot().aliveEnemiesOf(self.team()).size(),
        situation.litOwnBomb().isPresent(),
        ownBombDistance,
        situation
            .nearestArmableBomb()
            .map(bomb -> bomb.pos().distance(self.pos()))
            .orElse(Double.POSITIVE_INFINITY),
        situation.bombBeingArmedByUs().isPresent(),
        threatened,
        poison.active(),
        poison.intensity(),
        poison.active() && ownBombDistance <= poison.bombRadius(),
        context.hasGapples(),
        context.hasRewind());
  }

  /** The features quantized for a trace, so equal play gives equal hashes. */
  public List<DecisionTrace.Feature> quantized() {
    return List.of(
        new DecisionTrace.Feature("health", (int) Math.round(healthFrac * 20)),
        new DecisionTrace.Feature("enemyDist", quantize(nearestEnemyDistance)),
        new DecisionTrace.Feature("enemyConf", (int) Math.round(nearestEnemyConfidence * 10)),
        new DecisionTrace.Feature("visible", visibleEnemies),
        new DecisionTrace.Feature("known", knownEnemies),
        new DecisionTrace.Feature("allies", livingAllies),
        new DecisionTrace.Feature("enemies", livingEnemies),
        new DecisionTrace.Feature("ownLit", ownBombLit ? 1 : 0),
        new DecisionTrace.Feature("ownBombDist", quantize(ownBombDistance)),
        new DecisionTrace.Feature("enemyBombDist", quantize(enemyBombDistance)),
        new DecisionTrace.Feature("allyArming", allyArming ? 1 : 0),
        new DecisionTrace.Feature("bombThreat", enemyNearOwnBomb ? 1 : 0),
        new DecisionTrace.Feature("poison", poisonActive ? 1 : 0),
        new DecisionTrace.Feature("poisonZone", inOwnBombPoisonZone ? 1 : 0));
  }

  private static int quantize(double distance) {
    return Double.isFinite(distance) ? (int) Math.round(distance) : -1;
  }
}
