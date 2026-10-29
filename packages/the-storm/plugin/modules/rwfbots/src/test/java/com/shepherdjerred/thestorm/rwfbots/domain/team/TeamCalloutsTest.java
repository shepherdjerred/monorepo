package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TrainingYardNav;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * The team's objective calls: each moment once as it begins, by a bot whose hands are free, and an
 * enemy sighting addressed to the human it is next to.
 */
final class TeamCalloutsTest {

  private static final NavArtifact NAV = TrainingYardNav.NAV;
  private static final Places PLACES = new Places(NAV.sites(), new Vec3(32, 65, 32));
  private static final BombId RED_BOMB = new BombId(0);
  private static final BombId BLUE_BOMB = new BombId(1);
  private static final Vec3 RED_FUSE = NAV.sites().bomb("red-1").orElseThrow().cell().center();
  private static final Vec3 BLUE_FUSE = NAV.sites().bomb("blue-1").orElseThrow().cell().center();

  private static WorldSnapshot world(
      long tick, List<CombatantView> reds, BombState red, BombState blue) {
    var everyone = new ArrayList<>(reds);
    everyone.add(Fixtures.combatant(99, BLUE, new Vec3(60, 65, 31)));
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        everyone,
        List.of(
            new BombView(RED_BOMB, new BombOwner.Team(RED), RED_FUSE, red),
            new BombView(BLUE_BOMB, new BombOwner.Team(BLUE), BLUE_FUSE, blue)),
        PoisonView.NONE,
        NAV.mapId(),
        List.of(),
        List.of(),
        List.of());
  }

  private static Decision decision(CombatantView bot, Option option, BombId bomb, long tick) {
    return new Decision(
        bot.id(),
        option,
        Optional.empty(),
        List.of(),
        Stance.CAUTIOUS,
        Optional.of(bomb),
        Optional.empty(),
        Optional.empty(),
        option.name(),
        tick,
        0,
        Optional.empty());
  }

  /** Red's scene: its humans are the living reds of {@code world} that are not {@code bots}. */
  private static TeamCallouts.Scene scene(
      WorldSnapshot world,
      Blackboard board,
      Map<CombatantId, Decision> decisions,
      List<CombatantView> bots) {
    var humans = world.alive(RED).stream().filter(view -> !bots.contains(view)).toList();
    return new TeamCallouts.Scene(RED, world, board, decisions, bots, humans, PLACES);
  }

  @Test
  void anEnemyArmingOurBombIsCalledOnceByTheNearestBot() {
    var near = Fixtures.combatant(1, RED, RED_FUSE.plus(6, -0.5, 0));
    var far = Fixtures.combatant(2, RED, RED_FUSE.plus(30, -0.5, 0));
    var bots = List.of(far, near);
    var calls = new TeamCallouts();
    var board = Blackboard.open(RED, Strategy.RUSH);
    var arming = new BombState.Arming(BLUE, 0.3, 1);
    var first =
        calls.observe(scene(world(100, bots, arming, new BombState.Idle()), board, Map.of(), bots));
    assertThat(first)
        .singleElement()
        .satisfies(
            call -> {
              assertThat(call.kind()).isEqualTo(Callout.Kind.ENEMY_PLANTING);
              assertThat(call.speaker()).isEqualTo(near.id());
              assertThat(call.place()).isEqualTo("red bomb");
            });
    assertThat(
            calls.observe(
                scene(world(140, bots, arming, new BombState.Idle()), board, Map.of(), bots)))
        .as("the same moment is not called again")
        .isEmpty();
    assertThat(
            calls.observe(
                scene(
                    world(100 + TeamCallouts.REPEAT_TICKS, bots, arming, new BombState.Idle()),
                    board,
                    Map.of(),
                    bots)))
        .extracting(Callout::kind)
        .containsExactly(Callout.Kind.ENEMY_PLANTING);
  }

  @Test
  void ourBombLitIsCalledOncePerFuseAndANeedForADefuseWhenItBurnsLow() {
    var bot = Fixtures.combatant(1, RED, RED_FUSE.plus(10, -0.5, 0));
    var bots = List.of(bot);
    var calls = new TeamCallouts();
    var board = Blackboard.open(RED, Strategy.RUSH);
    var lit = new BombState.Armed(600);
    assertThat(
            calls.observe(scene(world(10, bots, lit, new BombState.Idle()), board, Map.of(), bots)))
        .extracting(Callout::kind)
        .containsExactly(Callout.Kind.RETAKING);
    assertThat(
            calls.observe(
                scene(
                    world(
                        10 + TeamCallouts.REPEAT_TICKS,
                        bots,
                        new BombState.Armed(500),
                        new BombState.Idle()),
                    board,
                    Map.of(),
                    bots)))
        .as("one call per fuse, however long it burns")
        .isEmpty();
    var low = new BombState.Armed(TeamCallouts.LOW_FUSE_TICKS);
    assertThat(
            calls.observe(
                scene(world(900, bots, low, new BombState.Idle()), board, Map.of(), bots)))
        .extracting(Callout::kind)
        .containsExactly(Callout.Kind.NEED_DEFUSE);
    // Someone on the fuse: nobody asks for a defuse.
    var quiet = new TeamCallouts();
    var defusing = Map.of(bot.id(), decision(bot, Option.DEFUSE, RED_BOMB, 900));
    assertThat(
            quiet.observe(
                scene(world(900, bots, low, new BombState.Idle()), board, defusing, bots)))
        .extracting(Callout::kind)
        .doesNotContain(Callout.Kind.NEED_DEFUSE)
        .contains(Callout.Kind.DEFUSING);
    // The fuse goes out and is lit again: a new fuse, a new call.
    calls.observe(
        scene(world(950, bots, new BombState.Idle(), new BombState.Idle()), board, Map.of(), bots));
    assertThat(
            calls.observe(
                scene(world(960, bots, lit, new BombState.Idle()), board, Map.of(), bots)))
        .extracting(Callout::kind)
        .contains(Callout.Kind.RETAKING);
  }

  @Test
  void aPlanterCallsItsOwnPlantOnTheWayAndATeammateCallsItOnceItIsAtTheFuse() {
    var planter = Fixtures.combatant(1, RED, BLUE_FUSE.plus(-15, -0.5, 0));
    var mate = Fixtures.combatant(2, RED, BLUE_FUSE.plus(-12, -0.5, 4));
    var bots = List.of(planter, mate);
    var board = Blackboard.open(RED, Strategy.RUSH);
    var arm = Map.of(planter.id(), decision(planter, Option.ARM, BLUE_BOMB, 10));
    var onTheWay =
        new TeamCallouts()
            .observe(
                scene(
                    world(10, bots, new BombState.Idle(), new BombState.Idle()), board, arm, bots));
    assertThat(onTheWay)
        .singleElement()
        .satisfies(
            call -> {
              assertThat(call.kind()).isEqualTo(Callout.Kind.PLANTING);
              assertThat(call.speaker()).isEqualTo(planter.id());
              assertThat(call.subject()).isEmpty();
              assertThat(call.place()).isEqualTo("blue bomb");
            });
    var atFuse = planter.withPos(BLUE_FUSE.plus(-1, -0.5, 0));
    var there = List.of(atFuse, mate);
    var clicking = Map.of(atFuse.id(), decision(atFuse, Option.ARM, BLUE_BOMB, 10));
    assertThat(
            new TeamCallouts()
                .observe(
                    scene(
                        world(10, there, new BombState.Idle(), new BombState.Arming(RED, 0.1, 1)),
                        board,
                        clicking,
                        there)))
        .singleElement()
        .satisfies(
            call -> {
              assertThat(call.speaker()).isEqualTo(mate.id());
              assertThat(call.subject()).contains(atFuse.id());
            });
  }

  @Test
  void aBotDealtToCoverAnArmingHumanTellsThemOnce() {
    var human = Fixtures.combatant(50, RED, BLUE_FUSE.plus(-2, -0.5, 0));
    var bot = Fixtures.combatant(1, RED, BLUE_FUSE.plus(-10, -0.5, 0));
    var slot =
        new Slot(
            Slot.supportKey(human.id(), 0),
            SlotKind.ESCORT,
            Role.ESCORT,
            human.pos(),
            human.pos().plus(5, 0, 0),
            -1,
            -1,
            Optional.empty(),
            HumanSupport.COVER_SIDE);
    var plan =
        new TeamPlan(
            Optional.of(Strategy.RUSH),
            Optional.empty(),
            Optional.empty(),
            List.of(),
            0.5,
            List.of(slot),
            Map.of(bot.id(), slot.key()),
            0,
            Map.of(),
            0);
    var board = Blackboard.open(RED, Strategy.RUSH).withPlan(plan, 0);
    var everyone = List.of(bot, human);
    var arming = world(20, everyone, new BombState.Idle(), new BombState.Arming(RED, 0.2, 1));
    var calls = new TeamCallouts();
    assertThat(calls.observe(scene(arming, board, Map.of(), List.of(bot))))
        .singleElement()
        .satisfies(
            call -> {
              assertThat(call.kind()).isEqualTo(Callout.Kind.COVERING);
              assertThat(call.speaker()).isEqualTo(bot.id());
              assertThat(call.subject()).contains(human.id());
            });
    assertThat(calls.observe(scene(arming, board, Map.of(), List.of(bot)))).isEmpty();
  }

  @Test
  void aBotStuckLosingAFightAsksForHelp() {
    var bot = Fixtures.combatant(1, RED, new Vec3(31, 65, 10)).withHealth(6, 0);
    var engaged =
        Blackboard.open(RED, Strategy.RUSH)
            .note(
                bot.id(),
                new TeamNote(Optional.empty(), Optional.empty(), java.util.Set.of()).engaged(0));
    var tick = Blackboard.PINNED_TICKS;
    var calls =
        new TeamCallouts()
            .observe(
                scene(
                    world(tick, List.of(bot), new BombState.Idle(), new BombState.Idle()),
                    engaged,
                    Map.of(),
                    List.of(bot)));
    assertThat(calls)
        .singleElement()
        .satisfies(
            call -> {
              assertThat(call.kind()).isEqualTo(Callout.Kind.NEED_HELP);
              assertThat(call.place()).isEqualTo("north mid");
            });
  }

  @Test
  void anEnemyNearAHumanIsCalledToThemWithWhereItIsFromThem() {
    // Fixtures face south (+z): an enemy north of the human is behind them, one east on their left.
    var human = Fixtures.combatant(50, RED, new Vec3(31, 65, 20));
    var behind =
        new SharedSighting(
            new CombatantId(99), new Vec3(31, 65, 12), Vec3.ZERO, 5, 5, new CombatantId(1));
    var call = TeamCallouts.enemy(behind, RED, List.of(human), PLACES);
    assertThat(call.subject()).contains(human.id());
    assertThat(call.bearing()).contains("behind you");
    assertThat(TeamCallouts.bearing(human, new Vec3(40, 65, 20))).isEqualTo("on your left");
    assertThat(TeamCallouts.bearing(human, new Vec3(22, 65, 20))).isEqualTo("on your right");
    assertThat(TeamCallouts.bearing(human, new Vec3(31, 65, 30))).isEqualTo("ahead of you");
    var far =
        new SharedSighting(new CombatantId(99), BLUE_FUSE, Vec3.ZERO, 5, 5, new CombatantId(1));
    var plain = TeamCallouts.enemy(far, RED, List.of(human), PLACES);
    assertThat(plain.subject()).isEmpty();
    assertThat(plain.place()).isEqualTo("blue bomb");
  }

  @Test
  void sightingsNearAHumanOrWhereTheyAreHeadingAreTheUsefulOnes() {
    var human = Fixtures.combatant(50, RED, new Vec3(20, 65, 31)).withVel(new Vec3(0.25, 0, 0));
    var humans = List.of(human);
    var beside = TeamCallouts.usefulness(new Vec3(22, 65, 31), humans);
    var ahead = TeamCallouts.usefulness(new Vec3(30, 65, 31), humans);
    var away = TeamCallouts.usefulness(new Vec3(20, 65, 60), humans);
    assertThat(beside).isLessThan(away);
    assertThat(ahead).as("ten blocks ahead along its path").isLessThan(1.0);
    assertThat(TeamCallouts.usefulness(new Vec3(0, 0, 0), List.of())).isZero();
  }
}
