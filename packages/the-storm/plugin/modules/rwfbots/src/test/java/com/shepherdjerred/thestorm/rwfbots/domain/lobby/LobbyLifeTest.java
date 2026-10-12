package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Bots in the lobby plan activities that last, walk the lobby's nav graph to where they mean to be,
 * and turn each plan into the same body commands match play uses; the same seed plans the same.
 */
final class LobbyLifeTest {

  private static final NavArtifact LOBBY = SyntheticMap.bakeLobby();
  private static final UUID BOT = new UUID(0, 1);
  private static final UUID HUMAN = new UUID(0, 2);
  private static final UUID RIVAL = new UUID(0, 3);

  private static LobbyScene scene(long tick, Vec3 bot) {
    return new LobbyScene(
        tick,
        List.of(
            new LobbyScene.Person(BOT, Optional.of("me"), bot),
            new LobbyScene.Person(HUMAN, Optional.empty(), new Vec3(4.5, 1, 20.5)),
            new LobbyScene.Person(RIVAL, Optional.of("old-foe"), new Vec3(10.5, 1, 6.5))));
  }

  private static LobbyLife.Self self(Archetype archetype, Optional<String> nextKit) {
    return new LobbyLife.Self(
        BOT, "me", LobbyTemperamentTest.of(archetype), List.of("old-foe"), nextKit);
  }

  /** Twenty planning rounds, each from where the last plan's walk would have ended. */
  private static List<LobbyPlan> trace(Archetype archetype, long seed) {
    var plans = new ArrayList<LobbyPlan>();
    var feet = new Vec3(6.5, 1, 12.5);
    Optional<LobbyPlan> current = Optional.empty();
    for (var round = 0; round < 20; round++) {
      var tick = round * 10L;
      var plan =
          LobbyLife.next(
              new LobbyLife.Input(
                  self(archetype, Optional.empty()), scene(tick, feet), LOBBY, current),
              new SplittableRandom(seed ^ tick));
      if (!plan.path().isEmpty() && current.filter(plan::equals).isEmpty()) {
        feet = plan.path().getLast().pos();
      }
      plans.add(plan);
      current = Optional.of(plan);
    }
    return plans;
  }

  @Test
  void theSameSeedPlansTheSameLobby() {
    assertThat(trace(Archetype.TROLL, 3)).isEqualTo(trace(Archetype.TROLL, 3));
    assertThat(trace(Archetype.TROLL, 3)).isNotEqualTo(trace(Archetype.TROLL, 4));
  }

  @Test
  void anActivityLastsUntilItsEndTickThenAnotherIsChosen() {
    var plans = trace(Archetype.SUPPORT, 11);

    for (var i = 1; i < plans.size(); i++) {
      var tick = i * 10L;
      if (tick < plans.get(i - 1).untilTick()) {
        assertThat(plans.get(i)).isSameAs(plans.get(i - 1));
      }
    }
    assertThat(plans.stream().map(LobbyPlan::activity).distinct().count()).isGreaterThan(1);
  }

  @Test
  void walksStayOnTheLobbysNavGraph() {
    for (var archetype : Archetype.values()) {
      for (var plan : trace(archetype, archetype.name().hashCode())) {
        for (var waypoint : plan.path()) {
          var node = LOBBY.graph().nearestNode(waypoint.pos());
          assertThat(node).isPresent();
          assertThat(LOBBY.graph().feet(node.getAsInt()).distance(waypoint.pos())).isLessThan(0.01);
        }
      }
    }
  }

  @Test
  void aBotOftenWalksUpToAHumanAndTapsSneakAsItsFirstMove() {
    var feet = new Vec3(6.5, 1, 12.5);
    var hellos = 0;
    for (var seed = 0; seed < 100; seed++) {
      var plan =
          LobbyLife.next(
              new LobbyLife.Input(
                  self(Archetype.FLANKER, Optional.empty()),
                  scene(0, feet),
                  LOBBY,
                  Optional.empty()),
              new SplittableRandom(seed));
      if (plan.activity() == Activity.SNEAK_TAP
          && plan.facing().filter(HUMAN::equals).isPresent()) {
        hellos++;
        assertThat(plan.sneakTaps()).isTrue();
        assertThat(plan.path().getLast().pos().horizontalDistance(new Vec3(4.5, 1, 20.5)))
            .isLessThan(3.5);
      }
    }
    assertThat(hellos).isBetween(30, 70);
  }

  @Test
  void browsingWalksToTheAlcoveOfTheNextKit() {
    var feet = new Vec3(6.5, 1, 12.5);
    for (var seed = 0; seed < 200; seed++) {
      var plan =
          LobbyLife.next(
              new LobbyLife.Input(
                  self(Archetype.TACTICIAN, Optional.of("shortbow")),
                  scene(0, feet),
                  LOBBY,
                  Optional.empty()),
              new SplittableRandom(seed));
      if (plan.activity() == Activity.BROWSE_KITS) {
        var alcove = LOBBY.sites().spawn(LobbyNav.alcove("shortbow")).orElseThrow();
        assertThat(plan.path().getLast().pos()).isEqualTo(alcove.cell().feet());
        assertThat(plan.glances()).isNotEmpty();
        return;
      }
    }
    throw new AssertionError("a tactician never browsed in 200 draws");
  }

  @Test
  void walkingUpToSomeoneStopsShortAndFacesThem() {
    var feet = new Vec3(6.5, 1, 12.5);
    var seen = 0;
    for (var seed = 0; seed < 300; seed++) {
      var plan =
          LobbyLife.next(
              new LobbyLife.Input(
                  self(Archetype.SUPPORT, Optional.empty()),
                  scene(0, feet),
                  LOBBY,
                  Optional.empty()),
              new SplittableRandom(seed));
      if (plan.activity() != Activity.APPROACH) {
        continue;
      }
      seen++;
      var target = plan.facing().orElseThrow();
      var at = scene(0, feet).person(target).orElseThrow().feet();
      var end = plan.path().isEmpty() ? feet : plan.path().getLast().pos();
      assertThat(end.horizontalDistance(at)).isBetween(0.5, LobbyTemperament.FURTHEST + 1);
    }
    assertThat(seen).isPositive();
  }

  @Test
  void steeringWalksThePathThenTapsSneakAndLetsGoWhenThePlanEnds() {
    var path =
        LOBBY
            .graph()
            .path(
                LOBBY.graph().nearestNode(new Vec3(6.5, 1, 12.5)).getAsInt(),
                LOBBY.graph().nearestNode(new Vec3(10.5, 1, 12.5)).getAsInt())
            .orElseThrow()
            .toFollow();
    var walk = new LobbyPlan(Activity.WANDER, path, List.of(), Optional.empty(), false, false, 100);
    var body = new LobbySteering.Body(new Vec3(6.5, 1, 12.5), true, Facing.SOUTH, Optional.empty());
    var greeting =
        new LobbySteering.Body(
            new Vec3(6.5, 1, 12.5), true, Facing.SOUTH, Optional.of(new Vec3(4.5, 1, 20.5)));

    var first = LobbySteering.tick(LobbySteering.State.FRESH, walk, body, 1);
    assertThat(first.commands())
        .first()
        .isEqualTo(new BodyCommand.MoveToward(path.getFirst().pos(), false));

    var greet =
        new LobbyPlan(
            Activity.SNEAK_TAP, List.of(), List.of(), Optional.of(HUMAN), true, false, 200);
    var state = first.state();
    var sneaks = new ArrayList<Boolean>();
    for (var tick = 101; tick < 120; tick++) {
      var step = LobbySteering.tick(state, greet, greeting, tick);
      state = step.state();
      for (var command : step.commands()) {
        if (command instanceof BodyCommand.Sneak(var sneaking)) {
          sneaks.add(sneaking);
        }
      }
      assertThat(step.commands()).anyMatch(BodyCommand.Look.class::isInstance);
    }
    assertThat(sneaks).contains(true, false).hasSizeGreaterThan(4);

    var after =
        new LobbyPlan(Activity.JUMP, List.of(), List.of(), Optional.empty(), false, true, 300);
    var released = state.sneaking();
    var step = LobbySteering.tick(state, after, body, 210);
    if (released) {
      assertThat(step.commands()).contains(new BodyCommand.Sneak(false));
    }
    assertThat(step.state().sneaking()).isFalse();
    assertThat(step.commands()).contains(new BodyCommand.Jump());
  }
}
