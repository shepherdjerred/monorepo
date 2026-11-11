package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.KitMove;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.Optional;

/**
 * An ender pearl from a supply crate. Escape and a close that is actually shorter go through
 * {@link PearlThrow}. Otherwise it is saved for a gap in the route: a ground waypoint ahead, with
 * no enemy in sword range.
 */
public final class CratePearl {

  /** A route gap shorter than this is walked. */
  static final double GAP_MIN = 8;

  private CratePearl() {}

  /** The throw, if this pearl should be spent now. */
  public static Optional<BodyCommand.UseKit> choose(
      Loadout.KitItem item, ReflexInput input, int waypointIndex, KitPlay.Means means) {
    var blink =
        new Loadout.KitItem(
            new KitMove(
                item.move().item(),
                KitMove.Use.BLINK,
                item.move().min(),
                item.move().max(),
                item.move().gapTicks()),
            item.slot());
    var thrown = PearlThrow.choose(blink, input, waypointIndex, means);
    if (thrown.isPresent()) {
      return thrown;
    }
    if (!gapOpen(input, waypointIndex) || means.grid().isEmpty()) {
      return Optional.empty();
    }
    var self = input.self();
    if (!self.onGround()
        || self.usingItem()
        || self.effectiveHealth() < PearlThrow.LANDING_COST + PearlThrow.SPARE) {
      return Optional.empty();
    }
    var grid = means.grid().orElseThrow();
    var waypoints = input.decision().waypoints();
    for (var i = Math.max(0, waypointIndex); i < waypoints.size(); i++) {
      var spot = waypoints.get(i);
      if (spot.landing() != Waypoint.Landing.GROUND) {
        continue;
      }
      var distance = spot.pos().distance(self.pos());
      if (distance < GAP_MIN || distance > item.move().max()) {
        continue;
      }
      var at = PearlThrow.aimAt(grid, self, spot.pos(), means.timing());
      if (at.isPresent()) {
        return Optional.of(new BodyCommand.UseKit(item.slot(), Optional.empty(), at));
      }
    }
    return Optional.empty();
  }

  /** Whether a clear ground waypoint ahead is far enough to spend a saved pearl. */
  static boolean gapOpen(ReflexInput input, int waypointIndex) {
    var self = input.self().pos();
    var crowded =
        input.perceived().stream()
                .anyMatch(enemy -> enemy.pos().distance(self) <= PearlThrow.SWORD_RANGE)
            || input
                .target()
                .filter(enemy -> enemy.pos().distance(self) <= PearlThrow.SWORD_RANGE)
                .isPresent();
    if (crowded) {
      return false;
    }
    var waypoints = input.decision().waypoints();
    for (var i = Math.max(0, waypointIndex); i < waypoints.size(); i++) {
      var spot = waypoints.get(i);
      if (spot.landing() != Waypoint.Landing.GROUND) {
        continue;
      }
      var distance = spot.pos().distance(self);
      if (distance >= GAP_MIN && distance <= 32) {
        return true;
      }
    }
    return false;
  }
}
