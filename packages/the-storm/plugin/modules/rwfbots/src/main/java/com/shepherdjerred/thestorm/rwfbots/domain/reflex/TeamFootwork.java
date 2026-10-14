package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.List;

/** Local team spacing and passage geometry for one immutable reflex frame. */
final class TeamFootwork {
  private static final double ALLY_SPACING = 0.9;
  private static final double YIELD_DISTANCE = 2.2;
  private static final double MOVING = 0.05;
  private final CombatantView self;
  private final List<CombatantView> allies;

  TeamFootwork(CombatantView self, List<CombatantView> allies) {
    this.self = self;
    this.allies = List.copyOf(allies);
  }

  /** Stronger repulsion at the predicted closest approach during the reaction window. */
  Vec3 apart(double spacing, int aheadTicks) {
    var push = Vec3.ZERO;
    for (var other : allies) {
      if (other.id().equals(self.id()) || !sharesFooting(other)) continue;
      var away = self.pos().minus(other.pos()).horizontal();
      var distance = away.length();
      var relative = self.vel().minus(other.vel()).horizontal();
      var closestTick =
          relative.isZero()
              ? 0
              : Math.clamp(-away.dot(relative) / relative.lengthSquared(), 0, aheadTicks);
      var separation = away.plus(relative.scale(closestTick));
      var closest = separation.length();
      if (closest < spacing && distance > 1.0e-3) {
        var direction = separation.isZero() ? away : separation;
        push = push.plus(direction.normalized().scale((spacing - closest) / spacing));
      }
    }
    return push;
  }

  /** A crowding correction never stops or reverses forward progress. */
  Vec3 bend(Vec3 destination, Vec3 push) {
    var heading = destination.minus(self.pos()).horizontal();
    if (push.isZero() || heading.isZero()) return destination;
    var forward = heading.normalized();
    var backward = Math.min(0, push.dot(forward));
    var correction = push.minus(forward.scale(backward));
    var direction = forward.plus(correction.scale(Reflex.SEPARATION_WEIGHT));
    var length = Math.max(heading.length(), 1);
    return self.pos().plus(direction.normalized().scale(length)).withY(destination.y());
  }

  /** Follow only a moving teammate who is already leaving the passage in the same direction. */
  boolean yields(Vec3 destination) {
    var heading = destination.minus(self.pos()).horizontal();
    if (heading.isZero()) return false;
    var forward = heading.normalized();
    for (var other : allies) {
      if (other.id().equals(self.id())
          || !sharesFooting(other)
          || other.vel().horizontal().dot(forward) < MOVING) continue;
      var toAlly = other.pos().minus(self.pos()).horizontal();
      var distance = toAlly.length();
      if (distance <= YIELD_DISTANCE && distance > 1.0e-3 && toAlly.normalized().dot(forward) > 0.5)
        return true;
    }
    return false;
  }

  boolean allyAhead(Vec3 destination) {
    var heading = destination.minus(self.pos()).horizontal();
    if (heading.isZero()) return false;
    for (var other : allies) {
      if (other.id().equals(self.id()) || !sharesFooting(other)) continue;
      var toAlly = other.pos().minus(self.pos());
      if (toAlly.length() <= ALLY_SPACING && toAlly.dot(heading) > 0) return true;
    }
    return false;
  }

  Vec3 sidestep(Vec3 destination, int strafeDirection) {
    var heading = destination.minus(self.pos()).horizontal().normalized();
    var side = new Vec3(-heading.z(), 0, heading.x()).scale(0.6 * strafeDirection);
    return destination.plus(side);
  }

  private boolean sharesFooting(CombatantView other) {
    return Math.abs(self.pos().y() - other.pos().y()) <= 1.5;
  }
}
