package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.RouteResult;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class RouteResultTest {
  private static final Vec3 START = new Vec3(5.5, 1, 5.5);
  private static final Planner.Way WAY = new Planner.Way(Stance.AGGRESSIVE, false);

  private record Fixture(Situation situation, TacticsContext context) {}

  private static Fixture fixture(NavArtifact nav) {
    var self = combatant(1, RED, START);
    var snapshot =
        new WorldSnapshot(
            10, MatchPhase.LIVE, List.of(self), List.of(), PoisonView.NONE, nav.mapId(), List.of());
    var situation =
        new Situation(
            self,
            snapshot,
            new Percept(PerceptionState.EMPTY, List.of(), 10),
            Blackboard.open(RED, Strategy.RUSH),
            Role.ROTATE);
    var context =
        new TacticsContext(
            nav,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42,
            null);
    return new Fixture(situation, context);
  }

  @Test
  void arrivalAndAReachableRouteAreDifferentTypedOutcomes() {
    var fixture = fixture(SyntheticMap.bake());
    assertThat(Planner.pathTo(fixture.situation(), fixture.context(), START, WAY))
        .isInstanceOf(RouteResult.Arrived.class);
    var route = Planner.pathTo(fixture.situation(), fixture.context(), START.plus(5, 0, 0), WAY);
    assertThat(route).isInstanceOf(RouteResult.Path.class);
    assertThat(route.waypoints()).isNotEmpty();
    assertThat(route.failure()).isEmpty();
  }

  @Test
  void aMissingGoalIsNotSilentlySnappedToAnUnrelatedDistantCell() {
    var fixture = fixture(SyntheticMap.bake());
    var goal = START.plus(1000, 0, 0);
    assertThat(Planner.pathTo(fixture.situation(), fixture.context(), goal, WAY))
        .isEqualTo(new RouteResult.Unreachable(goal, RouteResult.Problem.GOAL_OUTSIDE_NAVIGATION));
  }

  @Test
  void aDisconnectedGoalProducesADiagnosticAndCannotBecomeDirectCombatSteering() {
    var original = SyntheticMap.open();
    var blocks =
        new BlockClassification() {
          @Override
          public GridBounds bounds() {
            return original.bounds();
          }

          @Override
          public BlockShape shape(int x, int y, int z) {
            return x >= 12 && x <= 20 ? BlockShape.PASSABLE : original.shape(x, y, z);
          }

          @Override
          public boolean blocksSight(int x, int y, int z) {
            return (x < 12 || x > 20) ? original.blocksSight(x, y, z) : false;
          }
        };
    var nav = MapBaker.bake("split", blocks, SyntheticMap.sites());
    var fixture = fixture(nav);
    var goal = new Vec3(27.5, 1, 5.5);
    var decision =
        Planner.decide(
            Plan.of(Option.TAKE_SLOT, 10, new PlanStep.Route(goal, Stance.AGGRESSIVE)),
            fixture.situation(),
            fixture.context(),
            0);
    assertThat(decision.routeFailure())
        .contains(new RouteResult.Unreachable(goal, RouteResult.Problem.DISCONNECTED));
    var self = fixture.situation().self();
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(self, fixture.situation().snapshot(), decision, Optional.empty(), 0),
            new ReflexContext(nav.grid(), levers(1), Loadout.standard(Kit.TROOPER)),
            new SplittableRandom(42));
    assertThat(step.commands()).containsExactly(new BodyCommand.Stop());
  }
}
