package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsContext;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsState;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Quirks that show in the body: late starts and crouch spam (LOVES_NUKE is a slot fit). */
final class QuirksTest {

  private static SimWorld pair(long seed, Set<Quirk> quirks) {
    var world = new SimWorld(Arenas.SYNTHETIC, seed);
    world.addBomb(0, RED, SyntheticMap.RED_BOMB);
    world.addBomb(
        1, com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE, SyntheticMap.BLUE_BOMB);
    world.addBot(
        new SimWorld.Spawn(1, RED, Kit.TROOPER, SyntheticMap.RED_SPAWN.feet()),
        new SimWorld.Persona(
            LeverCurves.at(0.7), new Style(0.5, 0.5, 0.6, 0.5), Archetype.BOMB_DIVER, quirks));
    // A teammate, so the bot is not its team's last survivor (who always sneaks).
    world.addBot(
        new SimWorld.Spawn(2, RED, Kit.TROOPER, SyntheticMap.RED_SPAWN.offset(3, 0, 0).feet()),
        0.7);
    world.setStrategy(RED, Strategy.RUSH);
    return world;
  }

  @Test
  void aLateBotStandsAWhileBeforeItsFirstMove() {
    var start = SyntheticMap.RED_SPAWN.feet();
    var late = pair(3, Set.of(Quirk.LATE_TO_EVERYTHING));
    late.run(TacticsContext.LATE_MIN_TICKS - 2, w -> false);
    assertThat(late.body(1).distanceTo(start)).isLessThan(0.1);
    var keen = pair(3, Set.of());
    keen.run(TacticsContext.LATE_MIN_TICKS - 2, w -> false);
    assertThat(keen.body(1).distanceTo(start)).isGreaterThan(3);
    late.run(TacticsContext.LATE_MIN_TICKS + TacticsContext.LATE_SPREAD_TICKS + 40, w -> false);
    assertThat(late.body(1).distanceTo(start)).isGreaterThan(3);
  }

  @Test
  void openingDelayCountsDownWithoutRepeatingOnLaterLives() {
    var late = pair(3, Set.of(Quirk.LATE_TO_EVERYTHING));
    var context = late.body(1).tacticsContext;
    var duration = context.lateStartTicks();
    assertThat(context.remainingStartTicks(TacticsState.fresh(0), 1000)).isEqualTo(duration);
    late.run(1, w -> false);
    var firstLife = late.body(1).tactics;
    var born = firstLife.bornTick();
    assertThat(born).isNotNegative();
    assertThat(context.remainingStartTicks(firstLife, born + duration - 1)).isEqualTo(1);
    assertThat(context.remainingStartTicks(firstLife, born + duration)).isZero();
    assertThat(context.remainingStartTicks(firstLife, born + duration + 100)).isZero();
    assertThat(context.remainingStartTicks(firstLife.nextLife(1), born + 1)).isZero();
  }

  @Test
  void aCrouchSpammerTapsSneakWhileItStandsIdle() {
    var world = pair(5, Set.of(Quirk.CROUCH_SPAM, Quirk.LATE_TO_EVERYTHING));
    var down = new int[1];
    var up = new int[1];
    world.run(
        TacticsContext.LATE_MIN_TICKS,
        w -> {
          for (var command : w.body(1).lastCommands) {
            if (command instanceof BodyCommand.Sneak(var sneaking)) {
              (sneaking ? down : up)[0]++;
            }
          }
          return false;
        });
    assertThat(down[0]).isPositive();
    assertThat(up[0]).isPositive();
    var calm = pair(5, Set.of(Quirk.LATE_TO_EVERYTHING));
    calm.run(
        TacticsContext.LATE_MIN_TICKS,
        w -> {
          assertThat(w.body(1).lastCommands).noneMatch(BodyCommand.Sneak.class::isInstance);
          return false;
        });
  }
}
