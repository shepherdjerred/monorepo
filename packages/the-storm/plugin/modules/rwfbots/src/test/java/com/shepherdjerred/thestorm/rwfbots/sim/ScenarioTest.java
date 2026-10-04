package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.record.TraceHash;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.sim.SimWorld.Spawn;
import org.junit.jupiter.api.Test;

final class ScenarioTest {

  private static final NavArtifact NAV = SyntheticMap.bake();

  private static SimWorld world(long seed) {
    var world = new SimWorld(NAV, seed);
    world.addBomb(0, RED, SyntheticMap.RED_BOMB);
    world.addBomb(1, BLUE, SyntheticMap.BLUE_BOMB);
    return world;
  }

  private static SimWorld twoVersusNone(long seed) {
    var world = world(seed);
    world.addBot(new Spawn(1, RED, Kit.TROOPER, SyntheticMap.RED_SPAWN.feet()), 0.7);
    world.addBot(
        new Spawn(2, RED, Kit.TROOPER, SyntheticMap.RED_SPAWN.offset(1, 0, 1).feet()), 0.6);
    world.setStrategy(RED, Strategy.RUSH);
    return world;
  }

  @Test
  void twoBotsCrossTheMapArmTheEnemyBombAndWin() {
    var world = twoVersusNone(42);
    world.run(4000, w -> w.bomb(1).exploded());
    var blueBomb = world.bomb(1);
    assertThat(blueBomb.exploded()).as("blue bomb destroyed by tick %d", world.tick).isTrue();
    assertThat(blueBomb.armedAtTick).isLessThan(2000);
    assertThat(blueBomb.clickers).isEmpty();
    assertThat(world.body(1).alive).isTrue();
    assertThat(world.body(2).alive).isTrue();
    assertThat(world.bomb(0).exploded()).isFalse();
    var options = world.body(1).decisions.stream().map(d -> d.option()).distinct().toList();
    assertThat(options).containsAnyOf(Option.ARM, Option.HELP_ARM);
  }

  @Test
  void teammatesStackOnTheFuse() {
    var world = twoVersusNone(7);
    var maxClickers = new int[1];
    world.run(
        3000,
        w -> {
          maxClickers[0] = Math.max(maxClickers[0], w.bomb(1).clickers.size());
          return w.bomb(1).phase == SimBomb.Phase.ARMED;
        });
    assertThat(world.bomb(1).phase).isEqualTo(SimBomb.Phase.ARMED);
    assertThat(maxClickers[0]).isEqualTo(2);
  }

  @Test
  void aDefenderRetakesAndDefusesItsOwnArmedBomb() {
    var world = world(3);
    var defender =
        world.addBot(
            new Spawn(1, BLUE, Kit.TROOPER, SyntheticMap.BLUE_BOMB.offset(0, 0, 9).feet()), 0.8);
    world.addScripted(new Spawn(2, RED, Kit.TROOPER, SyntheticMap.RED_SPAWN.feet()));
    world.bomb(1).arm(0);
    world.run(900, w -> w.bomb(1).phase == SimBomb.Phase.IDLE);
    assertThat(world.bomb(1).phase)
        .as("defused by tick %d", world.tick)
        .isEqualTo(SimBomb.Phase.IDLE);
    assertThat(world.bomb(1).defusedAtTick).isBetween(180L, 900L);
    assertThat(defender.alive).isTrue();
    assertThat(defender.decisions.stream().map(d -> d.option())).contains(Option.DEFUSE);
  }

  @Test
  void theLastManArmsInstantly() {
    var world = world(11);
    world.addBot(
        new Spawn(1, RED, Kit.TROOPER, SyntheticMap.BLUE_BOMB.offset(-5, 0, 0).feet()), 0.9);
    world.addScripted(new Spawn(2, BLUE, Kit.TROOPER, SyntheticMap.BLUE_SPAWN.feet()));
    world.run(400, w -> w.bomb(1).phase == SimBomb.Phase.ARMED);
    var bomb = world.bomb(1);
    assertThat(bomb.phase).as("armed by tick %d", world.tick).isEqualTo(SimBomb.Phase.ARMED);
    assertThat(bomb.armedAtTick).isEqualTo(bomb.firstClickTick);
  }

  @Test
  void botsLeaveTheirOwnBombOncePoisonStarts() {
    // Red has nothing to arm (blue plays without a bomb) and its lone bot is patient, placid and
    // decisive, so it holds an angle next to its own bomb: exactly where poison must move it off.
    var world = new SimWorld(NAV, 5);
    world.addBomb(0, RED, SyntheticMap.RED_BOMB);
    var placid =
        LeverCurves.at(0.9).with(Lever.AGGRESSION, 0).with(Lever.DECISION_TEMPERATURE, 0.05);
    var guard =
        world.addBot(
            new Spawn(1, RED, Kit.TROOPER, SyntheticMap.RED_BOMB.offset(2, 0, 0).feet()),
            placid,
            new Style(0.1, 1.0, 0.5, 0.2));
    world.addScripted(new Spawn(2, BLUE, Kit.TROOPER, SyntheticMap.BLUE_SPAWN.feet()));
    world.setStrategy(RED, Strategy.TURTLE);
    var redBomb = SyntheticMap.RED_BOMB.center();
    world.startPoisonAt(300);
    world.run(300, w -> false);
    var distanceBeforePoison = guard.distanceTo(redBomb);
    world.run(600, w -> w.body(1).distanceTo(redBomb) > 19);
    assertThat(guard.alive).isTrue();
    assertThat(guard.distanceTo(redBomb))
        .as("left the bomb by tick %d", world.tick)
        .isGreaterThan(19);
    assertThat(guard.decisions.stream().map(d -> d.option())).contains(Option.ESCAPE_POISON);
    assertThat(distanceBeforePoison).isLessThan(19);
  }

  @Test
  void aSpyIsNotAttackedUntilItHitsAnAlly() {
    var world = world(13);
    var bot = world.addBot(new Spawn(1, RED, Kit.TROOPER, new Vec3(10.5, 1, 10.5)), 0.8);
    var ally = world.addScripted(new Spawn(2, RED, Kit.TROOPER, new Vec3(11.5, 1, 12.5)));
    var spy = world.addScripted(new Spawn(3, BLUE, Kit.SPY, new Vec3(12.0, 1, 10.5)));
    assertThat(spy.disguised).isTrue();
    world.run(200, w -> false);
    assertThat(bot.attacksOn(spy.id)).isZero();
    assertThat(bot.lastCommands).noneMatch(BodyCommand.Attack.class::isInstance);
    assertThat(ally.alive).isTrue();

    world.scriptedHit(3, 2);
    world.run(300, w -> w.body(1).attacksOn(new CombatantId(3)) > 0);
    assertThat(bot.attacksOn(spy.id)).as("attacked the spy by tick %d", world.tick).isPositive();
    assertThat(bot.perception.suspicion().isRevealed(spy.id)).isTrue();
  }

  @Test
  void sameSeedGivesTheSameTraceHash() {
    var first = twoVersusNone(99);
    first.run(1500, w -> false);
    var second = twoVersusNone(99);
    second.run(1500, w -> false);
    assertThat(first.hash).isEqualTo(second.hash);
    assertThat(first.hash).isNotEqualTo(TraceHash.EMPTY);
    var other = twoVersusNone(100);
    other.run(1500, w -> false);
    assertThat(other.hash).isNotEqualTo(first.hash);
  }
}
