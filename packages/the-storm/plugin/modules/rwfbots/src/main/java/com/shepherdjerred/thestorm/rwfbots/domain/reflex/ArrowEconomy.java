package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Quiver;

/**
 * How a bot spends arrows it cannot replace. A kit whose shots spend arrows (a crossbow, a bow
 * without Infinity) conserves once fewer than {@link #CONSERVE_BELOW} are left: it takes an enemy
 * inside {@link #CONSERVE_MELEE} blocks with its sword, and it looses a full draw only at a target
 * inside its sure range ({@link #sureRange}), once its aim has settled on the target and the target
 * is not sprint-strafing. A target that keeps strafing inside the sure range is shot after {@link
 * #PATIENCE_TICKS} in sight anyway, so a conserving archer never stands drawn at an enemy it could
 * hit. An Infinity bow, a trident and a fuller quiver shoot as before.
 */
public final class ArrowEconomy {

  /** A finite quiver with fewer arrows than this conserves them. */
  public static final int CONSERVE_BELOW = 10;

  /** A conserving bot swings its sword at an enemy this close rather than drawing. */
  static final double CONSERVE_MELEE = 8;

  /** A conserving bot already drawn keeps its draw until the enemy is this close. */
  static final double CONSERVE_KEEP = 6.5;

  /**
   * How far off target, in blocks, a conserving shot may land one aim-error deviation out: the sure
   * range is where the bot's aim error spreads this wide. The fighting band accepts 1.5 (2 for a
   * long bow), so a conserving bot holds out for shots about a third closer.
   */
  static final double SURE_SPREAD = 1.0;

  /** Every conserving archer's sure range reaches at least this far, past the melee range. */
  static final double SURE_NEAR = 10;

  /** No conserving archer counts a shot further than this as sure. */
  static final double SURE_FAR = 30;

  /**
   * A target moving across the line of fire faster than this, in blocks a tick, strafes too hard
   * for a sure shot: faster than a walk (0.216), so only a sprint-strafe counts.
   */
  static final double HARD_STRAFE = 0.25;

  /** A target inside the sure range this long in sight is shot however it moves, in ticks. */
  static final int PATIENCE_TICKS = 60;

  private ArrowEconomy() {}

  /** Whether {@code quiver} is running low enough to spend its arrows carefully. */
  public static boolean conserving(Quiver quiver) {
    return quiver.finite() && quiver.arrows() < CONSERVE_BELOW;
  }

  /** How far a conserving bot with {@code levers}' aim takes a shot at all. */
  public static double sureRange(Levers levers) {
    var aimed = SURE_SPREAD / StrictMath.tan(Math.toRadians(levers.aimErrorDeg()));
    return Math.clamp(aimed, SURE_NEAR, SURE_FAR);
  }

  /** How close a target may come before the bow gives way to the sword. */
  static double minimumRange(ReflexState state, Quiver quiver) {
    if (!conserving(quiver)) {
      return ReadyDraw.minimumRange(state);
    }
    return state.isDrawing() ? CONSERVE_KEEP : CONSERVE_MELEE;
  }

  /**
   * A full draw about to be loosed.
   *
   * @param self the archer
   * @param target who it aims at
   * @param settled whether its aim is on the target
   */
  record Shot(CombatantView self, CombatantView target, boolean settled) {}

  /**
   * Whether a full draw is loosed at {@code now}: as {@link ReadyDraw#steady} for an endless or
   * fuller quiver, as {@link #worthShot} for a conserving one.
   */
  static boolean looses(ReflexState state, long now, Shot shot, Levers levers) {
    if (!conserving(shot.self().quiver())) {
      return ReadyDraw.steady(state, now, shot.settled());
    }
    var since = state.bowSight().map(ReflexState.BowSight::since).orElse(now);
    return worthShot(shot, now - Math.max(state.drawStart(), since), levers);
  }

  /**
   * Whether a conserving archer looses {@code shot}, its target {@code inSight} ticks in sight of
   * this draw: inside its sure range, settled on a target that is not strafing hard, or inside the
   * range for {@link #PATIENCE_TICKS}.
   */
  static boolean worthShot(Shot shot, long inSight, Levers levers) {
    var distance = shot.self().pos().distance(shot.target().pos());
    if (distance > sureRange(levers)) {
      return false;
    }
    return (shot.settled() && !strafing(shot.self(), shot.target())) || inSight >= PATIENCE_TICKS;
  }

  /** Whether {@code target} moves across {@code self}'s line of fire faster than a walk. */
  static boolean strafing(CombatantView self, CombatantView target) {
    var line = target.pos().minus(self.pos()).horizontal();
    if (line.isZero()) {
      return false;
    }
    var along = line.normalized();
    var motion = target.vel().horizontal();
    return motion.minus(along.scale(motion.dot(along))).length() > HARD_STRAFE;
  }
}
