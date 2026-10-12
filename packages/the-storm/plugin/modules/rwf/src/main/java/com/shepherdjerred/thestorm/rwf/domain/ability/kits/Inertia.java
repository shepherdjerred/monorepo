// Kit description ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/kits/KitInertia.java), whose
// ability was never written; these rules are The Storm's own design from that description.
// See packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitAttacks;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * Inertia, "an unstoppable force that can be as much danger to itself as it is to others: damage
 * increases as you run, sharp turns negate this and running into a wall can be quite painful". Red
 * Warfare never wrote its ability; these are The Storm's rules from that description.
 *
 * <ul>
 *   <li>Every tick spent sprinting at speed ({@link #MIN_SPEED} blocks a tick or more) builds a
 *       point of momentum, up to {@link #MOST} (two seconds of running).
 *   <li>Its heading follows its facing slowly ({@link #FOLLOW} of the difference a tick); turning
 *       more than {@link #SHARP_TURN} degrees away from that heading in one go is a sharp turn and
 *       drops all momentum.
 *   <li>Not sprinting, momentum bleeds away {@link #DECAY} points a tick.
 *   <li>A melee hit deals {@code momentum / MOST × }{@link #MOST_BONUS} more, before armor.
 *   <li>Running into a wall with at least {@link #SLAM_THRESHOLD} momentum hurts the Inertia itself
 *       for {@code momentum / MOST × }{@link #MOST_SLAM}, ignoring armor, and stops it dead.
 * </ul>
 */
public final class Inertia implements Ability {

  public static final String ID = "inertia";

  public static final int MOST = 40;
  public static final double MIN_SPEED = 0.2;
  public static final double SHARP_TURN = 60;
  public static final double FOLLOW = 0.1;
  public static final int DECAY = 2;
  public static final double MOST_BONUS = 4;
  public static final int SLAM_THRESHOLD = 10;
  public static final double MOST_SLAM = 6;

  /**
   * An Inertia's run.
   *
   * @param momentum 0 to {@link #MOST}
   * @param heading the direction it is running, in degrees
   */
  public record State(int momentum, double heading) implements KitState {

    /** The damage a melee hit gains from this run. */
    public double bonus() {
      return MOST_BONUS * momentum / MOST;
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.effect(new AbilityEffect.Meter(self.id(), 0, 0));
    return new State(0, 0);
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    var before = arena.state(self.id(), State.class);
    run(self, motion, arena);
    var after = arena.state(self.id(), State.class);
    if (after.momentum() != before.momentum()) {
      arena.effect(new AbilityEffect.Meter(self.id(), 0, (float) after.momentum() / MOST));
    }
  }

  private static void run(Fighter self, Motion motion, Arena arena) {
    var state = arena.state(self.id(), State.class);
    if (motion.blocked() && state.momentum() >= SLAM_THRESHOLD) {
      var damage = MOST_SLAM * state.momentum() / MOST;
      arena.effect(new AbilityEffect.Damage(self.id(), damage, KitAttacks.WALL, Optional.empty()));
      arena.effect(new AbilityEffect.Cue(self.id(), KitCue.SLAMMED));
      arena.state(self.id(), new State(0, motion.yaw()));
      return;
    }
    if (!motion.sprinting() || motion.horizontalSpeed() < MIN_SPEED) {
      arena.state(self.id(), new State(Math.max(0, state.momentum() - DECAY), motion.yaw()));
      return;
    }
    var turn = difference(motion.yaw(), state.heading());
    if (state.momentum() > 0 && turn > SHARP_TURN) {
      arena.state(self.id(), new State(0, motion.yaw()));
      return;
    }
    var heading = state.momentum() == 0 ? motion.yaw() : follow(state.heading(), motion.yaw());
    arena.state(self.id(), new State(Math.min(MOST, state.momentum() + 1), heading));
  }

  @Override
  public DamageFormula.Hit dealing(KitState state, DamageFormula.Hit hit, RandomGenerator random) {
    if (!(state instanceof State run) || !hit.attack().has(AttackType.Flag.MELEE)) {
      return hit;
    }
    return hit.plus(run.bonus());
  }

  /** The smaller angle between two headings, 0 to 180 degrees. */
  public static double difference(double a, double b) {
    var d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
    return d;
  }

  /** {@code heading} moved {@link #FOLLOW} of the way toward {@code yaw}, the short way round. */
  public static double follow(double heading, double yaw) {
    var delta = ((yaw - heading) % 360 + 540) % 360 - 180;
    return heading + delta * FOLLOW;
  }
}
