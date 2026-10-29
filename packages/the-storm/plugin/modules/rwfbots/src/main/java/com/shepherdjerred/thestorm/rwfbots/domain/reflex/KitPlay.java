package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.KitMove;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * When a bot uses a kit item, from what it can fairly know this tick: the enemy it fights (only one
 * it sees), its own health, its teammates and where it is walking. A function of the tick and of
 * how promptly the bot notices a moment ({@link KitTiming}); the reflex layer spaces the uses out.
 * The kits whose moments take more judgement have their own classes: {@link SmokeCover}, {@link
 * RallyHorn}, {@link PearlThrow} and {@link WindCharge}.
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

  /**
   * The command that uses {@code item} now, if this is the moment for it, for a bot that acts the
   * tick a moment comes; {@code grid} is the map an aimed throw is checked against.
   */
  public static Optional<BodyCommand.UseKit> choose(
      Loadout.KitItem item, ReflexInput input, int waypointIndex, Optional<VoxelGrid> grid) {
    return choose(item, input, waypointIndex, new Means(grid, KitTiming.prompt()));
  }

  /**
   * What a bot brings to a kit move beyond the tick's input.
   *
   * @param grid the map an aimed throw or a launch is checked against, if known
   * @param timing how promptly it notices a moment and how true it throws
   */
  public record Means(Optional<VoxelGrid> grid, KitTiming timing) {}

  /**
   * The command that uses {@code item} now, if this is the moment for it and the bot notices it
   * ({@link Means#timing}).
   */
  public static Optional<BodyCommand.UseKit> choose(
      Loadout.KitItem item, ReflexInput input, int waypointIndex, Means means) {
    return switch (item.move().use()) {
      case COVER -> SmokeCover.choose(item, input, means.timing());
      case RALLY -> RallyHorn.choose(item, input, means.timing());
      case BLINK -> PearlThrow.choose(item, input, waypointIndex, means);
      case GUST -> WindCharge.choose(item, input, waypointIndex, means);
      default -> simple(item, input, waypointIndex);
    };
  }

  /** The kit moves whose moment is plain to see, acted on the tick it comes. */
  private static Optional<BodyCommand.UseKit> simple(
      Loadout.KitItem item, ReflexInput input, int waypointIndex) {
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
      default -> throw new IllegalStateException("a judged move has its own class: " + move);
    };
  }

  /**
   * The kit items a bot may reach for now: while it works a defuse, only cover (smoke), which hides
   * the defuse without stopping it.
   */
  static List<Loadout.KitItem> usable(Loadout loadout, boolean defusing) {
    return loadout.kitItems().stream()
        .filter(item -> !defusing || item.move().use() == KitMove.Use.COVER)
        .toList();
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
