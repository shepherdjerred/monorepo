package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.KitMove;
import java.util.Comparator;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * When a bot uses a kit item, from what it can fairly know this tick: the enemy it fights (only one
 * it sees), its own health, its teammates and where it is walking. A pure function; the reflex
 * layer spaces the uses out.
 */
public final class KitPlay {

  /** A hurt ally is one under this much health. */
  static final double HURT = 14;

  /** A bot defends itself under this much effective health. */
  static final double LOW = 10;

  /** How high above its feet a target is aimed at. */
  static final double CHEST = 1.2;

  private KitPlay() {}

  /**
   * The command that uses {@code item} now, if this is the moment for it.
   *
   * @param item the kit item and its slot
   * @param input the tick's input
   * @param waypointIndex the waypoint being walked to
   */
  public static Optional<BodyCommand.UseKit> choose(
      Loadout.KitItem item, ReflexInput input, int waypointIndex) {
    return choose(item, input, waypointIndex, Optional.empty());
  }

  public static Optional<BodyCommand.UseKit> choose(
      Loadout.KitItem item,
      ReflexInput input,
      int waypointIndex,
      Optional<com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid> grid) {
    if (item.move().item().equals("WIND_CHARGE")) return windJump(item, input, waypointIndex, grid);
    var move = item.move();
    var self = input.self();
    var target = input.target().filter(enemy -> within(self, enemy.pos(), move));
    return switch (move.use()) {
      case HEAL_ALLIES -> hurtAllyNear(input, move.max()) ? here(item) : Optional.empty();
      case PLACE ->
          input.target().isEmpty() && waypointIndex >= input.decision().waypoints().size()
              ? here(item)
              : Optional.empty();
      case AT_ENEMY -> target.map(enemy -> at(item, enemy, true));
      case TOUCH_ENEMY ->
          input
              .target()
              .filter(enemy -> near(self, enemy.pos(), move.max()))
              .map(enemy -> on(item, enemy));
      case TOUCH_ALLY ->
          allies(input)
              .filter(ally -> near(self, ally.pos(), move.max()))
              .min(Comparator.comparingDouble(ally -> self.pos().distance(ally.pos())))
              .map(ally -> on(item, ally));
      case FAR_ALLY ->
          input.target().filter(enemy -> near(self, enemy.pos(), move.min())).isPresent()
              ? Optional.empty()
              : allies(input)
                  .filter(ally -> within(self, ally.pos(), move))
                  .max(Comparator.comparingDouble(ally -> self.pos().distance(ally.pos())))
                  .map(ally -> on(item, ally));
      case SELF_LOW -> self.effectiveHealth() < LOW ? here(item) : Optional.empty();
      case DEFEND ->
          self.effectiveHealth() < LOW
              ? input
                  .target()
                  .filter(enemy -> near(self, enemy.pos(), move.max()))
                  .map(enemy -> at(item, enemy, false))
              : Optional.empty();
      case TRAVEL -> travel(item, input, waypointIndex);
    };
  }

  /** A wind charge jumps from broad supported ground, aimed at the feet rather than a waypoint. */
  private static Optional<BodyCommand.UseKit> windJump(
      Loadout.KitItem item,
      ReflexInput input,
      int index,
      Optional<com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid> grid) {
    var self = input.self();
    if (grid.isEmpty() || !self.onGround() || self.effectiveHealth() < LOW) return Optional.empty();
    var climb =
        index < input.decision().waypoints().size()
            && input.decision().waypoints().get(index).pos().y() > self.pos().y() + 1;
    var smash =
        self.kit() == com.shepherdjerred.thestorm.rwfbots.domain.world.Kit.MACEGUARD
            && input.target().filter(enemy -> enemy.pos().distance(self.pos()) <= 5).isPresent();
    if ((!climb && !smash) || !safeLaunch(grid.orElseThrow(), self.pos())) return Optional.empty();
    return Optional.of(
        new BodyCommand.UseKit(
            item.slot(), Optional.empty(), Optional.of(self.pos().plus(0, -0.1, 0))));
  }

  public static boolean safeLaunch(
      com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid grid, Vec3 feet) {
    var x = (int) Math.floor(feet.x());
    var y = (int) Math.floor(feet.y());
    var z = (int) Math.floor(feet.z());
    for (var dx = -2; dx <= 2; dx++) {
      for (var dz = -2; dz <= 2; dz++) {
        if (!safeColumn(
            grid, new com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos(x + dx, y, z + dz)))
          return false;
      }
    }
    return true;
  }

  private static boolean safeColumn(
      com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid grid,
      com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos feet) {
    var below =
        new com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos(
            feet.x(), feet.y() - 1, feet.z());
    if (!grid.bounds().contains(below) || !grid.blocksMovement(below)) return false;
    for (var dy = 0; dy <= 3; dy++) {
      var cell =
          new com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos(
              feet.x(), feet.y() + dy, feet.z());
      if (!grid.bounds().contains(cell) || grid.blocksMovement(cell)) return false;
    }
    return true;
  }

  private static Optional<BodyCommand.UseKit> here(Loadout.KitItem item) {
    return Optional.of(new BodyCommand.UseKit(item.slot(), Optional.empty(), Optional.empty()));
  }

  private static BodyCommand.UseKit at(Loadout.KitItem item, CombatantView enemy, boolean named) {
    return new BodyCommand.UseKit(
        item.slot(),
        named ? Optional.of(enemy.id()) : Optional.empty(),
        Optional.of(enemy.pos().plus(0, CHEST, 0)));
  }

  private static BodyCommand.UseKit on(Loadout.KitItem item, CombatantView enemy) {
    return new BodyCommand.UseKit(item.slot(), Optional.of(enemy.id()), Optional.empty());
  }

  private static Optional<BodyCommand.UseKit> travel(
      Loadout.KitItem item, ReflexInput input, int waypointIndex) {
    var waypoints = input.decision().waypoints();
    if (input.target().isPresent() || waypointIndex >= waypoints.size()) {
      return Optional.empty();
    }
    var next = waypoints.get(waypointIndex).pos();
    if (!within(input.self(), next, item.move())) {
      return Optional.empty();
    }
    return Optional.of(new BodyCommand.UseKit(item.slot(), Optional.empty(), Optional.of(next)));
  }

  /** The bot's living teammates, itself left out. */
  private static Stream<CombatantView> allies(ReflexInput input) {
    var self = input.self();
    return input.snapshot().alive(self.team()).stream()
        .filter(ally -> !ally.id().equals(self.id()));
  }

  private static boolean hurtAllyNear(ReflexInput input, double reach) {
    var self = input.self();
    return input.snapshot().alive(self.team()).stream()
        .anyMatch(
            ally ->
                !ally.id().equals(self.id())
                    && ally.health() < HURT
                    && near(self, ally.pos(), reach));
  }

  private static boolean within(CombatantView self, Vec3 point, KitMove move) {
    var distance = self.pos().distance(point);
    return distance >= move.min() && distance <= move.max();
  }

  private static boolean near(CombatantView self, Vec3 point, double reach) {
    return self.pos().distance(point) <= reach;
  }
}
