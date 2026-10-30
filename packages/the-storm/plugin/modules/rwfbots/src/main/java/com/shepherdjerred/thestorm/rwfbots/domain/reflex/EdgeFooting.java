package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;

/**
 * Where to stand in a melee near a drop. A blow pushes its victim straight away from the attacker
 * (rwf's 1.8 knockback: about 3 blocks for a plain hit and 7.6 for a sprint hit), so what matters
 * is the ground behind a fighter, opposite its enemy ({@link CombatFootwork#dropAlong}). A bot
 * circles towards the side that keeps ground behind itself and, when it can, puts a drop behind its
 * enemy; with a drop behind it, it leans in rather than backing off, which also takes some of the
 * push (rwf keeps half the victim's own velocity). rwf credits a pushed fall or void death to the
 * pusher, so the drop is a weapon both ways.
 */
final class EdgeFooting {

  /** How far a strafe is looked ahead, in blocks along the circle round the enemy. */
  static final double CIRCLE_STEP = 2.0;

  /** A circle that would step the body off its ground, worse than any push. */
  private static final int OFF_GROUND = -4;

  /** A drop behind the bot. */
  private static final int EXPOSED = -2;

  /** A drop behind the enemy. */
  private static final int OPENING = 1;

  /** Nothing about the ground changes the footwork. */
  static final Read NONE = new Read(false, false, 0, false);

  private EdgeFooting() {}

  /**
   * What the ground says about this tick's footwork.
   *
   * @param exposed a blow from the enemy now would push the bot over a drop
   * @param opening a blow on the enemy now would push it over a drop, and not the bot
   * @param side the strafe direction (+1 or -1) whose circle stands better, or 0 when both stand
   *     alike
   * @param hold both circles leave the bot exposed while it stands safe now: it keeps the line
   */
  record Read(boolean exposed, boolean opening, int side, boolean hold) {

    /**
     * How hard to close given the open-ground {@code closing}: with a drop behind it a bot never
     * backs off and leans in, which also takes some of the push; with its enemy's back to a drop it
     * presses in to deliver the push.
     */
    double closing(double closing) {
      if (exposed) return Math.max(closing, LEAN);
      return opening ? Math.max(closing, 1.0) : closing;
    }

    /**
     * How hard to circle given the open-ground {@code weight}: a bot whose either circle leaves a
     * drop behind it holds the line; one with its enemy's back to a drop circles only a little, to
     * keep it there.
     */
    double strafe(double weight) {
      if (hold) return Math.min(weight, HOLD_STRAFE);
      return opening ? Math.min(weight, OPENING_STRAFE) : weight;
    }
  }

  /** How hard a bot with a drop behind it leans in on its enemy. */
  static final double LEAN = 0.4;

  /** How hard a bot circles when either way round leaves a drop behind it. */
  static final double HOLD_STRAFE = 0.15;

  /** How hard a bot circles while its enemy's back is to a drop. */
  static final double OPENING_STRAFE = 0.3;

  /** The read for {@code self} fighting {@code enemy}; {@code radial} points from self to enemy. */
  static Read read(VoxelGrid grid, CombatantView self, CombatantView enemy, Vec3 radial) {
    var here = self.pos();
    var there = enemy.pos();
    var push = here.minus(there).horizontal();
    if (push.isZero()) return NONE;
    // An enemy who may sprint is assumed to: nearly every blow in a melee is a sprint hit. The bot
    // presses for a push only when even a plain blow would carry the enemy over.
    var reach =
        new Reach(
            CombatFootwork.pushReach(enemy.traversal().maySprint()), CombatFootwork.PUSH_REACH);
    var exposed = CombatFootwork.dropAlong(grid, here, push, reach.taken());
    var opening = !exposed && CombatFootwork.dropAlong(grid, there, push.scale(-1), reach.dealt());
    var across = new Vec3(-radial.z(), 0, radial.x());
    var plus = score(grid, circled(here, there, across), there, reach);
    var minus = score(grid, circled(here, there, across.scale(-1)), there, reach);
    var side = plus == minus ? 0 : plus > minus ? 1 : -1;
    var hold = !exposed && plus <= EXPOSED && minus <= EXPOSED;
    return new Read(exposed, opening, side, hold);
  }

  /** Where circling {@link #CIRCLE_STEP} along {@code across} leaves the body, at its distance. */
  private static Vec3 circled(Vec3 here, Vec3 enemy, Vec3 across) {
    var distance = here.horizontalDistance(enemy);
    var moved = here.plus(across.scale(CIRCLE_STEP)).minus(enemy).horizontal();
    if (moved.isZero()) return here;
    return new Vec3(enemy.x(), here.y(), enemy.z()).plus(moved.normalized().scale(distance));
  }

  /**
   * How far blows carry.
   *
   * @param taken the enemy's blow on the bot
   * @param dealt the bot's blow on the enemy
   */
  private record Reach(double taken, double dealt) {}

  /** How good a place {@code at} is to trade blows with an enemy at {@code enemy} from. */
  private static int score(VoxelGrid grid, Vec3 at, Vec3 enemy, Reach reach) {
    if (!CombatFootwork.grounded(grid, at)) return OFF_GROUND;
    var push = at.minus(enemy).horizontal();
    var score = 0;
    if (CombatFootwork.dropAlong(grid, at, push, reach.taken())) score += EXPOSED;
    if (CombatFootwork.dropAlong(grid, enemy, push.scale(-1), reach.dealt())) score += OPENING;
    return score;
  }
}
