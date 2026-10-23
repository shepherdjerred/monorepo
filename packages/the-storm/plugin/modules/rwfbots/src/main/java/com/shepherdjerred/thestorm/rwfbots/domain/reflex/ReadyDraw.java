package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.Optional;

/**
 * When a drawn bow stays up and when it may be loosed. A bow is held ready, aimed where its target
 * left sight, for {@link Reflex#HOLD_READY_TICKS} rather than lowered the tick the target ducks
 * behind cover, and it is never loosed through a teammate.
 */
final class ReadyDraw {

  /** A teammate this close to the line of fire, and nearer than the target, holds the shot. */
  static final double ALLY_CLEARANCE = 1.0;

  /** A bot whose aim will not settle on its target looses anyway after this long in sight. */
  static final int MAX_BOW_HOLD_TICKS = 32;

  private ReadyDraw() {}

  /** How close a target may come before the bow gives way to the sword. */
  static double minimumRange(ReflexState state) {
    return state.isDrawing() ? Reflex.BOW_KEEP_RANGE : Reflex.BOW_MIN_RANGE;
  }

  /**
   * Whether a full draw may be loosed: once aligned, or once the target has been in sight for
   * {@link #MAX_BOW_HOLD_TICKS}. That clock restarts when the target comes back into sight, so a
   * draw held ready through a gap does not fire the instant the target reappears, before the aim
   * has turned onto it.
   */
  static boolean steady(ReflexState state, long now, boolean aligned) {
    var since = state.bowSight().map(ReflexState.BowSight::since).orElse(now);
    return aligned || now - Math.max(state.drawStart(), since) >= MAX_BOW_HOLD_TICKS;
  }

  /**
   * Whether a drawn bow whose target has just left sight stays up: not while backing off or dashing
   * along a path with nobody to fight (drawing slows the bot to a walk), not past {@link
   * Reflex#HOLD_READY_TICKS}, and not with an enemy close enough to need the sword.
   */
  static boolean holds(ReflexState state, ReflexInput input, Loadout loadout) {
    var now = input.snapshot().tick();
    var sight = state.bowSight();
    return state.isDrawing()
        && loadout.hasBow()
        && input.decision().stance() != Stance.EVASIVE
        && !dashing(state, input)
        && sight.isPresent()
        && now - sight.orElseThrow().seen() <= Reflex.HOLD_READY_TICKS
        && !enemyWithin(input, Reflex.MELEE_ALERT);
  }

  /** Running a path at a sprint with no fight in the decision: cover or a slot comes first. */
  private static boolean dashing(ReflexState state, ReflexInput input) {
    var decision = input.decision();
    return state.waypointIndex() < decision.waypoints().size()
        && decision.stance() == Stance.AGGRESSIVE
        && decision.target().isEmpty();
  }

  private static boolean enemyWithin(ReflexInput input, double distance) {
    var self = input.self();
    return input.snapshot().aliveEnemiesOf(self.team()).stream()
        .anyMatch(enemy -> enemy.pos().distance(self.pos()) <= distance);
  }

  /**
   * The sighting at {@code now} of {@code target} at {@code point}, continuing an unbroken one of
   * the same target from last tick. A switch to another target restarts the clock, so the aim has
   * {@link #MAX_BOW_HOLD_TICKS} to settle on the new one before a forced release.
   */
  static ReflexState.BowSight sighted(
      Optional<ReflexState.BowSight> previous, CombatantId target, Vec3 point, long now) {
    var since =
        previous
            .filter(sight -> sight.seen() >= now - 1 && sight.target().equals(target))
            .map(ReflexState.BowSight::since)
            .orElse(now);
    return new ReflexState.BowSight(target, point, now, since);
  }

  /**
   * Whether a teammate of {@code self} stands within its line of fire to {@code aimPoint}, the led
   * point the arrow is actually sent to rather than where the target stands now.
   */
  static boolean allyInLine(WorldSnapshot snapshot, CombatantView self, Vec3 aimPoint) {
    var eye = self.eye();
    var line = aimPoint.minus(eye);
    var length = line.length();
    if (length < 1.0e-6) return false;
    var along = line.scale(1 / length);
    return snapshot.alive(self.team()).stream()
        .filter(ally -> !ally.id().equals(self.id()))
        .map(ally -> ally.pos().plus(0, 1.0, 0).minus(eye))
        .anyMatch(
            offset -> {
              var reach = offset.dot(along);
              return reach > 0
                  && reach < length
                  && offset.minus(along.scale(reach)).length() <= ALLY_CLEARANCE;
            });
  }
}
