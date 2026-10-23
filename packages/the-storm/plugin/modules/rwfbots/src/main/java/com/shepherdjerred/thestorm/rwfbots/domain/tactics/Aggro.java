package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Grudge;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.Optional;

/**
 * What a bot's {@link Grudge} does to its play: while the window lasts, the enemy who hurt it is
 * the threat it watches, the one it fights first, and the reason it leaves a lane. The pull is
 * clamped: it lapses once the bot has strayed {@link Grudge#LEASH} from where it was hit, a sword
 * only chases an attacker inside that leash, an archer only answers one it can see, a bot working a
 * fuse ignores anyone not in melee range, and low health leaves the choice to the survival options.
 */
public final class Aggro {

  /**
   * How many blocks closer than it stands the attacker counts when the bot picks whom to fight: a
   * bot answers the one who hit it rather than a slightly nearer bystander, but not one much
   * further off.
   */
  public static final double PREFERENCE = 8;

  private Aggro() {}

  /**
   * The bot's attacker as it now knows it.
   *
   * @param attacker who hit it
   * @param pos where the bot believes it is
   * @param distance how far that is from the bot
   * @param visible whether the bot sees it this tick
   * @param chase whether that place lies inside the leash, so a sword may close on it
   */
  public record Pull(
      CombatantId attacker, Vec3 pos, double distance, boolean visible, boolean chase) {}

  /** The pull on the bot in {@code situation}, if a grudge holds it. */
  public static Optional<Pull> pull(Situation situation) {
    var grudge = situation.percept().state().grudgeAt(situation.now());
    if (grudge.isEmpty()) {
      return Optional.empty();
    }
    var held = grudge.orElseThrow();
    var self = situation.self().pos();
    if (self.horizontalDistance(held.anchor()) > Grudge.LEASH) {
      return Optional.empty();
    }
    return situation.knownEnemies().stream()
        .filter(enemy -> enemy.id().equals(held.attacker()))
        .findFirst()
        .map(
            enemy ->
                new Pull(
                    enemy.id(),
                    enemy.pos(),
                    enemy.pos().distance(self),
                    enemy.visible(),
                    enemy.pos().horizontalDistance(held.anchor()) <= Grudge.LEASH))
        .filter(pull -> !atFuse(situation) || pull.distance() <= ObjectivePolicy.IMMEDIATE_MELEE);
  }

  /** The attacker the bot may fight now: in sight for a bow, inside the leash for a sword. */
  static Optional<Pull> fightable(Situation situation, TacticsContext context) {
    return pull(situation).filter(pull -> context.keep().ranged() ? pull.visible() : pull.chase());
  }

  /**
   * Whether an enemy {@code distance} away is a more pressing fight than the attacker {@code
   * attackerDistance} away: it is in melee range while the attacker is not, or it stands more than
   * {@link #PREFERENCE} nearer.
   */
  public static boolean outranks(double distance, double attackerDistance) {
    var melee = ObjectivePolicy.IMMEDIATE_MELEE;
    return (distance <= melee && attackerDistance > melee)
        || distance < attackerDistance - PREFERENCE;
  }

  /** Where the bot looks while it holds: at the attacker, while the grudge lasts. */
  static Optional<Vec3> watch(Situation situation) {
    return pull(situation).map(Pull::pos);
  }

  /**
   * Whether the bot is working a fuse: in reach of a bomb its team is arming, or of the bomb its
   * plant slot names. Arming is the round; a shot from afar does not pull the bot off it.
   */
  private static boolean atFuse(Situation situation) {
    var eye = situation.self().eye();
    var arming =
        situation.snapshot().bombs().stream()
            .filter(
                bomb ->
                    bomb.state() instanceof BombState.Arming(var team, var _, var _)
                        && team.equals(situation.self().team()))
            .anyMatch(bomb -> bomb.pos().distance(eye) <= Reflex.BOMB_REACH);
    return arming
        || situation
            .plantTarget()
            .filter(bomb -> bomb.pos().distance(eye) <= Reflex.BOMB_REACH)
            .isPresent();
  }
}
