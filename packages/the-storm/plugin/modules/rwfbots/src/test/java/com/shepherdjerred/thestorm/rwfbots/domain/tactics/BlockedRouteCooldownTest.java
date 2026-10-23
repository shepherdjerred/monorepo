package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class BlockedRouteCooldownTest {
  private static final Vec3 START = new Vec3(5.5, 1, 5.5);
  private static final Vec3 GOAL = START.plus(1000, 0, 0);
  private static final TacticsContext CONTEXT =
      new TacticsContext(
          SyntheticMap.bake(),
          levers(1),
          new Style(0.5, 0.5, 0.5, 0.5),
          Kit.TROOPER,
          Archetype.TACTICIAN,
          Set.of(),
          42,
          null);

  private static Situation situation(long tick, List<BombView> bombs) {
    return situation(tick, bombs, GOAL);
  }

  private static Situation situation(long tick, List<BombView> bombs, Vec3 goal) {
    var self = combatant(1, RED, START);
    var slot =
        new Slot(
            "blocked-slot", SlotKind.FLANK, Role.ROTATE, goal, goal, -1, -1, Optional.empty(), 0);
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .withPlan(
                new TeamPlan(
                    Optional.of(Strategy.RUSH),
                    Optional.of(START),
                    Optional.empty(),
                    List.of(),
                    0.5,
                    List.of(slot),
                    Map.of(self.id(), slot.key()),
                    0,
                    Map.of()),
                0);
    var snapshot =
        new WorldSnapshot(
            tick,
            MatchPhase.LIVE,
            List.of(self, combatant(2, BLUE, START.plus(20, 0, 0))),
            bombs,
            PoisonView.NONE,
            CONTEXT.nav().mapId(),
            List.of(),
            List.of());
    return new Situation(
        self, snapshot, new Percept(PerceptionState.EMPTY, List.of(), tick), board, Role.ROTATE);
  }

  private static TacticsState state(long tick, TacticalMemory memory) {
    var plan =
        Plan.of(Option.TAKE_SLOT, tick - 5, new PlanStep.Route(GOAL, Stance.AGGRESSIVE, true));
    return new TacticsState(Optional.of(plan), tick - 5, 1, 0, RewindClock.UNSTARTED, memory);
  }

  private static Thought think(long tick, TacticalMemory memory) {
    return Tactics.think(
        state(tick, memory), situation(tick, List.of()), CONTEXT, new SplittableRandom(1));
  }

  @Test
  void rememberedUnreachableSlotsRecoverWithoutExtendingTheRetryDeadline() {
    var memory = TacticalMemory.EMPTY.blocked(GOAL, 50);
    for (var tick : List.of(100L, 125L)) {
      var thought = think(tick, memory);
      assertThat(thought.decision().option()).isEqualTo(Option.RECOVER);
      assertThat(thought.state().memory().blockedUntil()).containsEntry(GOAL, 150L);
      memory = thought.state().memory();
    }
  }

  @Test
  void anUnreachableSlotIsRetriedAtTheExactDeadline() {
    var memory = TacticalMemory.EMPTY.blocked(GOAL, 50);
    assertThat(memory.excludes(GOAL, 150)).isFalse();
    var thought = think(150, memory);
    assertThat(thought.state().memory().blockedUntil()).containsEntry(GOAL, 250L);
    assertThat(thought.decision().option()).isEqualTo(Option.RECOVER);
  }

  @Test
  void aForcedDefuseBypassesTheExcludedFormationSlot() {
    var bomb =
        new BombView(
            new BombId(0),
            new BombOwner.Team(RED),
            CONTEXT.nav().sites().bombs().getFirst().cell().center(),
            new BombState.Armed(900));
    var memory =
        TacticalMemory.EMPTY
            .blocked(GOAL, 50)
            .objective(Optional.of(bomb.id()), Optional.empty(), 0);
    var situation = situation(100, List.of(bomb));
    assertThat(ObjectivePolicy.direct(memory, situation, CONTEXT).forced()).contains(Option.DEFUSE);
    var thought = Tactics.think(state(100, memory), situation, CONTEXT, new SplittableRandom(1));
    assertThat(thought.decision().option()).isEqualTo(Option.DEFUSE);
    assertThat(thought.state().memory().defusing()).contains(bomb.id());
    assertThat(thought.state().memory().blockedUntil()).containsEntry(GOAL, 150L);
  }

  @Test
  void anExcludedFormationSlotCannotReplaceAnUrgentPoisonEscape() {
    var bomb = new BombView(new BombId(0), new BombOwner.Team(RED), START, new BombState.Idle());
    var assignedSlot = new Vec3(28.5, 1, 20.5);
    var original = situation(100, List.of(bomb), assignedSlot);
    var snapshot = original.snapshot();
    var poisoned =
        new WorldSnapshot(
            snapshot.tick(),
            snapshot.matchPhase(),
            snapshot.combatants(),
            snapshot.bombs(),
            PoisonView.startedAt(0, 0.1),
            snapshot.mapId(),
            snapshot.stimuli(),
            List.of());
    var scene =
        new Situation(
            original.self(), poisoned, original.percept(), original.board(), original.role());
    var slot = Planner.slotPoint(scene, CONTEXT).orElseThrow();
    assertThat(slot).isEqualTo(assignedSlot);
    assertThat(CONTEXT.nav().graph().nearestNode(slot)).isPresent();
    var memory = TacticalMemory.EMPTY.blocked(slot, 50);
    assertThat(ObjectivePolicy.direct(memory, scene, CONTEXT).forced()).isEmpty();
    var escape = Planner.expand(Option.ESCAPE_POISON, scene, CONTEXT);
    assertThat(escape.current()).isInstanceOf(PlanStep.Route.class);
    assertThat(((PlanStep.Route) escape.current()).goal()).isNotEqualTo(slot);
    assertThat(memory.excludes(((PlanStep.Route) escape.current()).goal(), 100)).isFalse();
    assertThat(Planner.decide(escape, scene, CONTEXT, 1).routeFailure()).isEmpty();
    var thought = Tactics.think(state(100, memory), scene, CONTEXT, new SplittableRandom(1));
    assertThat(thought.trace().choice()).isEqualTo(Option.ESCAPE_POISON);
    assertThat(thought.decision().option()).isEqualTo(Option.ESCAPE_POISON);
    assertThat(thought.state().plan())
        .hasValueSatisfying(plan -> assertThat(plan.option()).isEqualTo(Option.ESCAPE_POISON));
    assertThat(thought.state().memory().blockedUntil()).containsEntry(slot, 150L);
  }

  @Test
  void anExcludedFormationSlotCannotReplaceYoungCombatPlans() {
    for (var option : List.of(Option.ENGAGE, Option.RETREAT)) {
      var original = situation(100, List.of());
      var self = option == Option.RETREAT ? original.self().withHealth(4, 0) : original.self();
      var enemy = combatant(2, BLUE, START.plus(3, 0, 0));
      var snapshot =
          new WorldSnapshot(
              100,
              MatchPhase.LIVE,
              List.of(self, enemy),
              List.of(),
              PoisonView.NONE,
              CONTEXT.nav().mapId(),
              List.of(),
              List.of());
      var scene =
          new Situation(
              self,
              snapshot,
              new Percept(PerceptionState.EMPTY, List.of(enemy), 100),
              original.board(),
              original.role());
      PlanStep step =
          option == Option.ENGAGE
              ? new PlanStep.Fight(enemy.id())
              : new PlanStep.Flee(START.plus(0, 0, 4), Optional.empty());
      var plan = Plan.of(option, 95, step);
      for (var memory : List.of(TacticalMemory.EMPTY, TacticalMemory.EMPTY.blocked(GOAL, 50))) {
        var state = new TacticsState(Optional.of(plan), 95, 1, 0, RewindClock.UNSTARTED, memory);
        assertThat(ObjectivePolicy.direct(memory, scene, CONTEXT).forced()).isEmpty();
        var thought = Tactics.think(state, scene, CONTEXT, new SplittableRandom(1));
        assertThat(thought.trace().choice()).isEqualTo(option);
        assertThat(thought.decision().option()).isEqualTo(option);
        assertThat(thought.state().plan()).contains(plan);
        assertThat(thought.state().memory().blockedUntil()).isEqualTo(memory.blockedUntil());
      }
    }
  }

  @Test
  void aNewLifeDropsThePreviousLivesBlockedDestinations() {
    var next = state(100, TacticalMemory.EMPTY.blocked(GOAL, 50)).nextLife(2);
    assertThat(next.lifeEpoch()).isEqualTo(2);
    assertThat(next.memory().blockedUntil()).isEmpty();
    assertThat(next.plan()).isEmpty();
  }
}
