package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.Optional;

/**
 * When a Smokescreen puts its smoke down. The smoke is a sphere of radius 4 around where it stands
 * for 6 seconds, and blocks every sight line through it, a bot's and a player's alike; blows and
 * arrows still pass, so smoke never wins a sword fight. It hides the bot from eyes further off:
 *
 * <ul>
 *   <li>hurt, with an enemy in sight, so it can break away unseen;
 *   <li>working a bomb's fuse while an enemy watches from beyond sword reach, so the plant or the
 *       defuse goes on unseen and unshot;
 *   <li>outnumbered by the enemies it sees close by, so they lose it before they swarm it.
 * </ul>
 *
 * <p>The smoke recharges in 30 seconds, which is the item's gap.
 */
public final class SmokeCover {

  /** Smoke hides a fuse from enemies further than this; a closer one fights through it anyway. */
  static final double FUSE_WATCHER_NEAREST = 4.5;

  /** An enemy further than this is no threat to a fuse worth smoking for. */
  static final double FUSE_WATCHER_FARTHEST = 32;

  /** The fewest enemies close by that make the bot outnumbered. */
  static final int OUTNUMBERED_BY = 2;

  private SmokeCover() {}

  /** The smoke, if this is its moment. */
  public static Optional<BodyCommand.UseKit> choose(
      Loadout.KitItem item, ReflexInput input, KitTiming timing) {
    if (!(hurtInSight(input, item.move().max())
        || fuseWatched(input)
        || outnumbered(input, item.move().max()))) {
      return Optional.empty();
    }
    return timing.notices()
        ? Optional.of(new BodyCommand.UseKit(item.slot(), Optional.empty(), Optional.empty()))
        : Optional.empty();
  }

  /** Hurt with an enemy in sight within {@code reach}. */
  static boolean hurtInSight(ReflexInput input, double reach) {
    var self = input.self();
    return self.effectiveHealth() < KitPlay.LOW
        && input.perceived().stream().anyMatch(enemy -> near(self, enemy, reach));
  }

  /** At a bomb it plants or defuses, with an enemy watching from beyond sword reach. */
  static boolean fuseWatched(ReflexInput input) {
    var self = input.self();
    var fusing =
        switch (input.decision().option()) {
          case ARM, HELP_ARM, DEFUSE -> true;
          default -> false;
        };
    var atBomb =
        input
            .decision()
            .bomb()
            .flatMap(input.snapshot()::bomb)
            .filter(bomb -> bomb.pos().distance(self.eye()) <= Reflex.BOMB_REACH + 1)
            .isPresent();
    return fusing
        && atBomb
        && input.perceived().stream()
            .anyMatch(
                enemy -> {
                  var distance = enemy.pos().distance(self.pos());
                  return distance > FUSE_WATCHER_NEAREST && distance <= FUSE_WATCHER_FARTHEST;
                });
  }

  /** More enemies in sight within {@code reach} than teammates there, and at least two. */
  static boolean outnumbered(ReflexInput input, double reach) {
    var self = input.self();
    var enemies = input.perceived().stream().filter(enemy -> near(self, enemy, reach)).count();
    var allies =
        input.snapshot().alive(self.team()).stream()
            .filter(ally -> !ally.id().equals(self.id()) && near(self, ally, reach))
            .count();
    return enemies >= OUTNUMBERED_BY && enemies > allies + 1;
  }

  private static boolean near(CombatantView self, CombatantView other, double reach) {
    return self.pos().distance(other.pos()) <= reach;
  }
}
