package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Suspicion;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class VisiblePursuitTest {
  private static final NavArtifact NAV = SyntheticMap.bake();

  @Test
  void visibleEnemyBehindGlassGetsARouteThroughTheDoorway() {
    var self = combatant(1, RED, new Vec3(15.5, 1, 20.5));
    var enemy = combatant(2, BLUE, new Vec3(17.5, 1, 20.5));
    assertThat(NAV.grid().canSee(self.eye(), enemy.eye())).isTrue();
    var decision = decision(self, enemy);
    assertThat(decision.target()).contains(enemy.id());
    assertThat(decision.waypoints()).isNotEmpty();
    assertThat(decision.waypoints())
        .anySatisfy(point -> assertThat(point.pos().z()).isBetween(15.0, 17.0));
    assertThat(decision.waypoints().getLast().pos()).isEqualTo(enemy.pos());
  }

  @Test
  void visibleEnemyOnOpenGroundKeepsTheCheapDirectApproach() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var enemy = combatant(2, BLUE, new Vec3(12.5, 1, 5.5));
    assertThat(decision(self, enemy).waypoints()).isEmpty();
  }

  @Test
  void aVisibleEnemyOnARaisedBlockGetsTheBakedJumpApproach() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 8.5));
    var enemy = combatant(2, BLUE, new Vec3(8.5, 2, 8.5));
    assertThat(NAV.grid().canSee(self.eye(), enemy.eye())).isTrue();
    var route = decision(self, enemy).waypoints();
    assertThat(route).anyMatch(point -> point.hop() == Hop.JUMP);
    assertThat(route.getLast().pos()).isEqualTo(enemy.pos());
  }

  @Test
  void aVisibleEnemyCannotOverrideTheSuppliedRouteAroundGlass() {
    var self = combatant(1, RED, new Vec3(15.5, 1, 20.5));
    var enemy = combatant(2, BLUE, new Vec3(17.5, 1, 20.5));
    var path =
        NAV.graph()
            .path(
                NAV.graph().nearestNode(self.pos()).orElseThrow(),
                NAV.graph().nearestNode(enemy.pos()).orElseThrow())
            .orElseThrow()
            .toFollow();
    var route =
        new Decision(
            self.id(),
            Option.ENGAGE,
            Optional.of(enemy.id()),
            path,
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "engage:fight",
            10,
            0,
            java.util.Optional.empty());
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(self, snapshot(self, enemy), route, Optional.of(enemy), 0, List.of()),
            new ReflexContext(NAV.grid(), levers(1), Loadout.standard(Kit.TROOPER)),
            new SplittableRandom(196));
    var first = path.getFirst();
    assertThat(first.hop()).isEqualTo(Hop.LEAP);
    var launch = first.launch().orElseThrow();
    assertThat(step.commands())
        .filteredOn(BodyCommand.MoveToward.class::isInstance)
        .singleElement()
        .isEqualTo(new BodyCommand.MoveToward(launch.runUpStart(), true));
    assertThat(step.state().activeJump())
        .hasValueSatisfying(
            active -> {
              assertThat(active.waypoint()).isEqualTo(first);
              assertThat(active.stage()).isEqualTo(ActiveJump.Stage.BACKUP);
            });
    var desired = Facing.looking(self.eye(), enemy.pos().plus(0, 1.3, 0));
    assertThat(step.state().aim().look().differenceTo(desired))
        .isLessThan(self.facing().differenceTo(desired));
    assertThat(step.commands())
        .noneMatch(
            command ->
                command instanceof BodyCommand.Attack || command instanceof BodyCommand.Swing);
  }

  @Test
  void reachingOpenSwordContactOverridesAnOldApproachRoute() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var enemy = combatant(2, BLUE, new Vec3(8, 1, 5.5));
    var oldApproach = new Waypoint(new Vec3(5.5, 1, 4.5), Hop.WALK);
    var route =
        new Decision(
            self.id(),
            Option.ENGAGE,
            Optional.of(enemy.id()),
            List.of(oldApproach),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "engage:fight",
            10,
            0,
            java.util.Optional.empty());
    var look = Facing.looking(self.eye(), enemy.pos().plus(0, 1.3, 0));
    var step =
        Reflex.tick(
            ReflexState.initial(look),
            new ReflexInput(self, snapshot(self, enemy), route, Optional.of(enemy), 0, List.of()),
            new ReflexContext(NAV.grid(), levers(1), Loadout.standard(Kit.TROOPER)),
            new SplittableRandom(196));
    assertThat(step.commands()).anyMatch(BodyCommand.Attack.class::isInstance);
    assertThat(step.commands())
        .filteredOn(BodyCommand.MoveToward.class::isInstance)
        .singleElement()
        .satisfies(
            command ->
                assertThat(((BodyCommand.MoveToward) command).waypoint())
                    .isNotEqualTo(oldApproach.pos()));
  }

  private static Decision decision(CombatantView self, CombatantView enemy) {
    var percept =
        new Percept(new PerceptionState(Memory.EMPTY, Suspicion.NONE), List.of(enemy), 10);
    var situation =
        new Situation(
            self, snapshot(self, enemy), percept, Blackboard.open(RED, Strategy.SPLIT), Role.HUNT);
    var context =
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            196,
            null);
    return Planner.decide(
        Plan.of(Option.ENGAGE, 10, new PlanStep.Fight(enemy.id())), situation, context, 0);
  }

  private static WorldSnapshot snapshot(CombatantView self, CombatantView enemy) {
    return new WorldSnapshot(
        10,
        MatchPhase.LIVE,
        List.of(self, enemy),
        List.of(),
        PoisonView.NONE,
        NAV.mapId(),
        List.of(),
        List.of(), List.of());
  }
}
