package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.Optional;

/**
 * When a Tactician sounds its horn. The horn takes a 1.2-second windup standing still, which any
 * step or hurt breaks, and then gives every teammate within 8 blocks (not the Tactician) Speed I
 * and Resistance I for 6 seconds. So it is sounded just before a fight, never in one:
 *
 * <ul>
 *   <li>the bot stands on the ground with its hands free; its body comes to rest before the horn is
 *       raised, since a body still sliding would break the windup;
 *   <li>at least two teammates stand within the move's {@code max}, a little inside the horn's
 *       reach so they are still in it when it sounds;
 *   <li>no enemy is in sight within the move's {@code min}, and nothing has hurt the bot lately;
 *   <li>a fight is coming: an enemy is in sight further off, or the team is at a bomb (planting,
 *       defusing, or retaking one).
 * </ul>
 *
 * <p>The horn recharges in 40 seconds, which is the item's gap. While the windup runs the server
 * holds the body still.
 */
public final class RallyHorn {

  /** The fewest teammates in reach that make the horn worth sounding. */
  static final int ALLIES = 2;

  /** A hurt this recent, in ticks, means the bot is in a fight already. */
  static final long CALM_TICKS = 40;

  /** An enemy in sight this far away or nearer means a fight is coming. */
  static final double COMING = 40;

  private RallyHorn() {}

  /** The horn, if this is its moment. */
  public static Optional<BodyCommand.UseKit> choose(
      Loadout.KitItem item, ReflexInput input, KitTiming timing) {
    var self = input.self();
    var move = item.move();
    var allies =
        input.snapshot().alive(self.team()).stream()
            .filter(ally -> !ally.id().equals(self.id()) && near(self, ally, move.max()))
            .count();
    var moment =
        standing(self)
            && allies >= ALLIES
            && calm(input, move.min())
            && fightComing(input)
            && input.target().filter(enemy -> near(self, enemy, move.min())).isEmpty();
    if (!moment || !timing.notices()) {
      return Optional.empty();
    }
    return Optional.of(new BodyCommand.UseKit(item.slot(), Optional.empty(), Optional.empty()));
  }

  static boolean standing(CombatantView self) {
    return self.onGround() && !self.usingItem();
  }

  /** No enemy in sight within {@code clear}, and no hurt lately. */
  static boolean calm(ReflexInput input, double clear) {
    var self = input.self();
    var hurt =
        self.lastHurtTick() >= 0 && input.snapshot().tick() - self.lastHurtTick() < CALM_TICKS;
    return !hurt && input.perceived().stream().noneMatch(enemy -> near(self, enemy, clear));
  }

  /** An enemy in sight further off, or the team's work at a bomb. */
  static boolean fightComing(ReflexInput input) {
    var self = input.self();
    var bombWork =
        switch (input.decision().option()) {
          case ARM, HELP_ARM, DEFUSE, RETAKE -> true;
          default -> false;
        };
    return bombWork || input.perceived().stream().anyMatch(enemy -> near(self, enemy, COMING));
  }

  private static boolean near(CombatantView self, CombatantView other, double reach) {
    return self.pos().distance(other.pos()) <= reach;
  }
}
