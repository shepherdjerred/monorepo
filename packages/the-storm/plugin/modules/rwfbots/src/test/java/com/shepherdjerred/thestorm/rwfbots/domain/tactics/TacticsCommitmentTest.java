package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Sighting;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SharedSighting;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class TacticsCommitmentTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final Vec3 SELF = new Vec3(5.5, 1, 5.5);
  private static final Optional<Plan> ROUTE =
      Optional.of(
          Plan.of(
              Option.TAKE_SLOT, 0, new PlanStep.Route(new Vec3(25.5, 1, 15.5), Stance.AGGRESSIVE)));

  private record Formation(SlotKind kind, Optional<Vec3> slot, boolean teamed) {}

  private static Situation situation(Role role, double enemyDistance, long hurtTick) {
    return situation(
        role,
        enemyDistance,
        hurtTick,
        new Formation(SlotKind.FLANK, Optional.of(new Vec3(25.5, 1, 15.5)), true));
  }

  private static Situation sweep(
      double enemyDistance, double slotDistance, long hurtTick, boolean teamed) {
    return situation(
        Role.HUNT,
        enemyDistance,
        hurtTick,
        new Formation(SlotKind.SWEEP, Optional.of(SELF.plus(0, 0, slotDistance)), teamed));
  }

  private static Situation situation(
      Role role, double enemyDistance, long hurtTick, Formation formation) {
    var kind = formation.kind();
    var self = combatant(1, RED, SELF).withLastHurtTick(hurtTick);
    var enemy = combatant(2, BLUE, SELF.plus(enemyDistance, 0, 0));
    var bodies = new java.util.ArrayList<>(List.of(self, enemy));
    if (formation.teamed()) bodies.add(combatant(3, RED, SELF.plus(0, 0, 4)));
    var strategy = kind == SlotKind.SWEEP ? Strategy.HUNT : Strategy.RUSH;
    var board = Blackboard.open(RED, strategy);
    if (formation.slot().isPresent()) {
      var slot =
          new Slot(
              kind.name().toLowerCase(java.util.Locale.ROOT) + "-0",
              kind,
              role,
              formation.slot().orElseThrow(),
              enemy.pos(),
              -1,
              -1,
              Optional.empty(),
              0);
      board =
          board.withPlan(
              new TeamPlan(
                  Optional.of(strategy),
                  Optional.of(SELF),
                  Optional.empty(),
                  List.of(),
                  0.5,
                  List.of(slot),
                  Map.of(self.id(), slot.key()),
                  0,
                  Map.of()),
              0);
    }
    var snapshot =
        new WorldSnapshot(
            100, MatchPhase.LIVE, bodies, List.of(), PoisonView.NONE, "synthetic", List.of());
    return new Situation(
        self, snapshot, new Percept(PerceptionState.EMPTY, List.of(enemy), 100), board, role);
  }

  @Test
  void anUncoveredBoundKeepsItsDestinationAtTheNextThinkWhileOrdinarySlotRoutesRefresh() {
    var situation = situation(Role.ROTATE, 20, -1);
    var context =
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42,
            null);
    for (var committed : List.of(false, true)) {
      var step = new PlanStep.Route(SELF.plus(6, 0, 0), Stance.CAUTIOUS, committed);
      var plan = Plan.of(Option.TAKE_SLOT, 92, step);
      var thought =
          Tactics.think(
              new TacticsState(
                  Optional.of(plan), 92, 0, 0, RewindClock.UNSTARTED, TacticalMemory.EMPTY),
              situation,
              context,
              new SplittableRandom(1));
      if (committed) assertThat(thought.state().plan()).hasValue(plan);
      else assertThat(thought.state().plan().orElseThrow()).isNotEqualTo(plan);
    }
    assertThat(new PlanStep.Route(SELF, Stance.CAUTIOUS).committedBound()).isFalse();
  }

  @Test
  void anArrivedBoundCompletesAndUrgentNeedsCanStillPreemptAnUnfinishedBound() {
    var situation = situation(Role.ROTATE, 20, -1);
    var context =
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42,
            null);
    var arrived = Plan.of(Option.TAKE_SLOT, 92, new PlanStep.Route(SELF, Stance.CAUTIOUS, true));
    var thought =
        Tactics.think(
            new TacticsState(
                Optional.of(arrived), 92, 0, 0, RewindClock.UNSTARTED, TacticalMemory.EMPTY),
            situation,
            context,
            new SplittableRandom(1));
    assertThat(thought.state().plan().orElseThrow()).isNotEqualTo(arrived);
    var pending =
        Optional.of(
            Plan.of(
                Option.TAKE_SLOT,
                92,
                new PlanStep.Route(SELF.plus(6, 0, 0), Stance.CAUTIOUS, true)));
    for (var urgent : List.of(Option.DEFUSE, Option.ESCAPE_POISON, Option.HEAL, Option.RETREAT))
      assertThat(Tactics.choose(urgent, pending, situation, Map.of())).isEqualTo(urgent);
  }

  @Test
  void aFlankCompletesItsRouteInsteadOfJoiningDistantFightsOrTheSameBomb() {
    for (var picked : List.of(Option.HUNT, Option.ENGAGE, Option.ARM, Option.HELP_ARM)) {
      assertThat(Tactics.choose(picked, ROUTE, situation(Role.ROTATE, 20, -1), Map.of()))
          .as("distant detour %s", picked)
          .isEqualTo(Option.TAKE_SLOT);
    }
  }

  @Test
  void aFlankKeepsItsAssignmentInCoverAndBetweenCompletedBounds() {
    var cover =
        Optional.of(
            Plan.of(
                Option.TAKE_SLOT,
                0,
                new PlanStep.Cover(Optional.empty(), SELF, SELF.plus(20, 0, 0), 110)));
    for (var current : List.of(cover, Optional.<Plan>empty())) {
      for (var picked : List.of(Option.HUNT, Option.ENGAGE, Option.ARM, Option.HELP_ARM)) {
        assertThat(Tactics.choose(picked, current, situation(Role.ROTATE, 20, -1), Map.of()))
            .as("unfinished flank in %s when %s picked", current, picked)
            .isEqualTo(Option.TAKE_SLOT);
      }
    }
  }

  @Test
  void aCompletedOrUnassignedFlankAndTheLastSurvivorMayChooseAnotherGoal() {
    for (var point : List.of(Optional.of(SELF), Optional.<Vec3>empty())) {
      assertThat(
              Tactics.choose(
                  Option.HUNT,
                  ROUTE,
                  situation(Role.ROTATE, 20, -1, new Formation(SlotKind.FLANK, point, true)),
                  Map.of()))
          .isEqualTo(Option.HUNT);
    }
    assertThat(
            Tactics.choose(
                Option.ARM,
                ROUTE,
                situation(
                    Role.ROTATE,
                    20,
                    -1,
                    new Formation(SlotKind.FLANK, Optional.of(new Vec3(25.5, 1, 15.5)), false)),
                Map.of()))
        .isEqualTo(Option.ARM);
  }

  @Test
  void anExistingFightIsNotCancelledToRejoinAnUnfinishedLane() {
    var fight =
        Optional.of(
            Plan.of(
                Option.ENGAGE,
                0,
                new PlanStep.Fight(
                    new com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId(2))));
    assertThat(Tactics.choose(Option.ENGAGE, fight, situation(Role.ROTATE, 20, -1), Map.of()))
        .isEqualTo(Option.ENGAGE);
  }

  @Test
  void closeContactAndRecentDamageMayInterruptTheFlank() {
    assertThat(Tactics.choose(Option.ENGAGE, ROUTE, situation(Role.ROTATE, 3, -1), Map.of()))
        .isEqualTo(Option.ENGAGE);
    assertThat(Tactics.choose(Option.ENGAGE, ROUTE, situation(Role.ROTATE, 20, 95), Map.of()))
        .isEqualTo(Option.ENGAGE);
  }

  private static Situation rememberedThreat(
      SlotKind kind, double visibleDistance, double rememberedDistance, boolean shared) {
    var base =
        situation(
            kind.role(),
            visibleDistance,
            -1,
            new Formation(kind, Optional.of(new Vec3(25.5, 1, 15.5)), true));
    var hidden = combatant(4, BLUE, SELF.plus(6, 0, 0));
    var bodies = new ArrayList<>(base.snapshot().combatants());
    bodies.add(hidden);
    var rememberedPosition = SELF.plus(rememberedDistance, 0, 0);
    var memory =
        shared
            ? Memory.EMPTY
            : new Memory(
                Map.of(hidden.id(), new Sighting(rememberedPosition, Vec3.ZERO, 76, 0.6, false)));
    var board = base.board();
    if (shared) {
      board =
          board.share(
              List.of(
                  new SharedSighting(
                      hidden.id(),
                      rememberedPosition,
                      Vec3.ZERO,
                      76,
                      76,
                      base.snapshot().combatants().getLast().id())),
              1,
              100,
              new SplittableRandom(1));
    }
    return new Situation(
        base.self(),
        new WorldSnapshot(
            100, MatchPhase.LIVE, bodies, List.of(), PoisonView.NONE, NAV.mapId(), List.of()),
        new Percept(
            new PerceptionState(memory, PerceptionState.EMPTY.suspicion()),
            base.percept().visible(),
            100),
        board,
        kind.role());
  }

  @Test
  void aRememberedCloseEnemyDoesNotInterruptAnUnfinishedLaneOrSweep() {
    for (var kind : List.of(SlotKind.FLANK, SlotKind.SWEEP)) {
      var scene = rememberedThreat(kind, 15, 3.8, false);
      assertThat(scene.nearestEnemy().orElseThrow().visible()).isFalse();
      assertThat(Tactics.choose(Option.ENGAGE, ROUTE, scene, Map.of()))
          .as("%s keeps its route despite a stale nearby prediction", kind)
          .isEqualTo(Option.TAKE_SLOT);
    }
  }

  @Test
  void aSharedCloseSightingDoesNotInterruptAnUnfinishedLaneOrSweep() {
    for (var kind : List.of(SlotKind.FLANK, SlotKind.SWEEP)) {
      var scene = rememberedThreat(kind, 15, 3.8, true);
      assertThat(scene.nearestEnemy().orElseThrow().visible()).isFalse();
      assertThat(Tactics.choose(Option.ENGAGE, ROUTE, scene, Map.of()))
          .as("%s keeps its route despite a nearby teammate report", kind)
          .isEqualTo(Option.TAKE_SLOT);
    }
  }

  @Test
  void visibleCloseContactStillInterruptsWhenUnseenMemorySortsNearer() {
    for (var kind : List.of(SlotKind.FLANK, SlotKind.SWEEP)) {
      var scene = rememberedThreat(kind, 3.5, 1, false);
      assertThat(scene.nearestEnemy().orElseThrow().visible()).isFalse();
      assertThat(Tactics.choose(Option.ENGAGE, ROUTE, scene, Map.of()))
          .as("%s answers the other visible close enemy", kind)
          .isEqualTo(Option.ENGAGE);
    }
  }

  @Test
  void survivalAndDefusingStillOverrideTheFlank() {
    for (var picked : List.of(Option.DEFUSE, Option.ESCAPE_POISON, Option.HEAL, Option.RETREAT)) {
      assertThat(Tactics.choose(picked, ROUTE, situation(Role.ROTATE, 20, -1), Map.of()))
          .as("urgent option %s", picked)
          .isEqualTo(picked);
    }
  }

  @Test
  void anEscortMayHelpAtTheBombWhileTraveling() {
    assertThat(Tactics.choose(Option.HELP_ARM, ROUTE, situation(Role.ESCORT, 20, -1), Map.of()))
        .isEqualTo(Option.HELP_ARM);
  }

  private static void assertSweepKeepsAssignment(Optional<Plan> current) {
    // The Paper showcase's healthy sweepers abandoned slots 11–14 blocks away
    // for hunts and fuse help while enemies were still 12–14 blocks away.
    for (var scene : List.of(sweep(12, 11, -1, true), sweep(14, 14, -1, true))) {
      for (var picked : List.of(Option.HUNT, Option.ENGAGE, Option.ARM, Option.HELP_ARM)) {
        assertThat(Tactics.choose(picked, current, scene, Map.of()))
            .as("unfinished sweep in %s when %s picked", current, picked)
            .isEqualTo(Option.TAKE_SLOT);
      }
    }
  }

  @Test
  void aSweepCompletesItsRouteBeforeDistantHuntsFightsAndFuseHelp() {
    assertSweepKeepsAssignment(ROUTE);
  }

  @Test
  void aSweepKeepsItsAssignmentDuringACoverBound() {
    assertSweepKeepsAssignment(
        Optional.of(
            Plan.of(
                Option.TAKE_SLOT,
                0,
                new PlanStep.Cover(Optional.empty(), SELF, SELF.plus(20, 0, 0), 110))));
  }

  @Test
  void aSweepKeepsItsAssignmentBetweenCompletedBounds() {
    assertSweepKeepsAssignment(Optional.empty());
  }

  @Test
  void aCompletedOrUnassignedSweepAndTheLastSurvivorMayChooseAnotherGoal() {
    for (var scene :
        List.of(
            sweep(12, 0, -1, true),
            situation(Role.HUNT, 12, -1, new Formation(SlotKind.SWEEP, Optional.empty(), true)),
            sweep(12, 11, -1, false))) {
      for (var picked : List.of(Option.HUNT, Option.ENGAGE, Option.ARM, Option.HELP_ARM)) {
        assertThat(Tactics.choose(picked, ROUTE, scene, Map.of()))
            .as("released sweep when %s picked", picked)
            .isEqualTo(picked);
      }
    }
  }

  @Test
  void closeContactAndRecentDamageMayInterruptTheSweep() {
    for (var scene : List.of(sweep(4, 11, -1, true), sweep(12, 11, 80, true))) {
      for (var picked : List.of(Option.HUNT, Option.ENGAGE, Option.ARM, Option.HELP_ARM)) {
        assertThat(Tactics.choose(picked, ROUTE, scene, Map.of()))
            .as("threatened sweep when %s picked", picked)
            .isEqualTo(picked);
      }
    }
  }

  @Test
  void olderDamageDoesNotSendAnUnfinishedSweepIntoADistantFight() {
    assertThat(Tactics.choose(Option.ENGAGE, ROUTE, sweep(12, 11, 79, true), Map.of()))
        .isEqualTo(Option.TAKE_SLOT);
  }

  @Test
  void survivalDefusingAndRetakingStillOverrideTheSweep() {
    for (var picked :
        List.of(Option.DEFUSE, Option.ESCAPE_POISON, Option.HEAL, Option.RETREAT, Option.RETAKE)) {
      assertThat(Tactics.choose(picked, ROUTE, sweep(12, 11, -1, true), Map.of()))
          .as("urgent option %s", picked)
          .isEqualTo(picked);
    }
  }

  @Test
  void anExistingFightIsNotCancelledToRejoinAnUnfinishedSweep() {
    var fight =
        Optional.of(
            Plan.of(
                Option.ENGAGE,
                95,
                new PlanStep.Fight(
                    new com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId(2))));
    assertThat(Tactics.choose(Option.HUNT, fight, sweep(12, 11, -1, true), Map.of()))
        .isEqualTo(Option.ENGAGE);
  }

  @Test
  void aContinuingSweepUsesTheLatestDealtGoal() {
    var assigned = sweep(12, 11, -1, true);
    var quiet =
        new Situation(
            assigned.self(),
            assigned.snapshot(),
            new Percept(PerceptionState.EMPTY, List.of(), 100),
            assigned.board(),
            Role.HUNT);
    var context =
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42,
            null);
    var thought =
        Tactics.think(
            new TacticsState(ROUTE, 90, 0, 0, RewindClock.UNSTARTED, TacticalMemory.EMPTY),
            quiet,
            context,
            new SplittableRandom(1));
    assertThat(thought.state().plan().orElseThrow().current())
        .isEqualTo(new PlanStep.Route(assigned.slot().orElseThrow().pos(), Stance.AGGRESSIVE));
    assertThat(thought.state().plan().orElseThrow().startedTick()).isZero();
  }

  private static Thought afterBombChange(Option option, PlanStep action, BombView bomb) {
    var self = combatant(1, RED, SELF);
    var plan =
        Plan.of(option, 90, new PlanStep.Route(new Vec3(30.5, 1, 10.5), Stance.CAUTIOUS), action);
    var snapshot =
        new WorldSnapshot(
            100,
            MatchPhase.LIVE,
            List.of(self),
            List.of(bomb),
            PoisonView.NONE,
            NAV.mapId(),
            List.of());
    return Tactics.think(
        new TacticsState(Optional.of(plan), 90, 0, 0, RewindClock.UNSTARTED, TacticalMemory.EMPTY),
        new Situation(
            self,
            snapshot,
            new Percept(PerceptionState.EMPTY, List.of(), 100),
            Blackboard.open(RED, Strategy.RUSH),
            Role.ROTATE),
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42,
            null),
        new SplittableRandom(1));
  }

  @Test
  void aYoungHoldInOldCoverYieldsWhenTheLatestDealtSlotHasMovedBeyondItsEnvelope() {
    var situation = situation(Role.ROTATE, 20, -1);
    var context =
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42,
            null);
    var node = NAV.graph().nearestNode(SELF).orElseThrow();
    var old =
        Plan.of(
            Option.HOLD_SLOT,
            95,
            new PlanStep.Cover(Optional.of(node), SELF, SELF.plus(20, 0, 0), 200));
    assertThat(Planner.coverFitsSlot(old, situation, context)).isFalse();
    var thought =
        Tactics.think(
            new TacticsState(
                Optional.of(old), 95, 0, 0, RewindClock.UNSTARTED, TacticalMemory.EMPTY),
            situation,
            context,
            new SplittableRandom(1));
    assertThat(thought.decision().option()).isEqualTo(Option.TAKE_SLOT);
    assertThat(thought.state().plan().orElseThrow().startedTick()).isEqualTo(100);
    var advancing = Plan.of(Option.TAKE_SLOT, 95, old.current());
    assertThat(Planner.coverFitsSlot(advancing, situation, context)).isTrue();
  }

  @Test
  void aYoungCoverPlanYieldsWhenAnUnclaimedTeammateOccupiesItsDestination() {
    var situation = situation(Role.ROTATE, 20, -1);
    var context =
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42,
            null);
    var node = NAV.graph().nearestNode(SELF).orElseThrow();
    var plan =
        Plan.of(
            Option.TAKE_SLOT,
            95,
            new PlanStep.Cover(Optional.of(node), SELF, SELF.plus(20, 0, 0), 200));
    var original = situation.snapshot();
    var bodies =
        original.combatants().stream()
            .map(body -> body.id().value() == 3 ? body.withPos(SELF.plus(1, 0, 0)) : body)
            .toList();
    var snapshot =
        new WorldSnapshot(
            original.tick(),
            original.matchPhase(),
            bodies,
            original.bombs(),
            original.poison(),
            original.mapId(),
            original.stimuli());
    var occupied =
        new Situation(
            situation.self(), snapshot, situation.percept(), situation.board(), situation.role());
    assertThat(situation.board().claimedCover()).isEmpty();
    assertThat(Planner.coverAvailable(situation, context, node)).isTrue();
    assertThat(Planner.coverAvailable(occupied, context, node)).isFalse();
    var thought =
        Tactics.think(
            new TacticsState(
                Optional.of(plan), 95, 0, 0, RewindClock.UNSTARTED, TacticalMemory.EMPTY),
            occupied,
            context,
            new SplittableRandom(1));
    assertThat(thought.state().plan().orElseThrow()).isNotEqualTo(plan);
  }

  @Test
  void aYoungCoverPlanYieldsWhenATeammateClaimsItsSpace() {
    var situation = situation(Role.ROTATE, 20, -1);
    var context =
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42,
            null);
    var node = NAV.graph().nearestNode(SELF).orElseThrow();
    var nearby = NAV.graph().nearestNode(SELF.plus(1, 0, 0)).orElseThrow();
    var plan =
        Plan.of(
            Option.TAKE_SLOT,
            95,
            new PlanStep.Cover(Optional.of(node), SELF, SELF.plus(20, 0, 0), 200));
    var state =
        new TacticsState(Optional.of(plan), 95, 0, 0, RewindClock.UNSTARTED, TacticalMemory.EMPTY);
    var board =
        situation
            .board()
            .claimCover(situation.self().id(), node)
            .claimCover(
                new com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId(3), nearby);
    var contested =
        new Situation(
            situation.self(), situation.snapshot(), situation.percept(), board, situation.role());
    assertThat(Planner.coverAvailable(situation, context, node)).isTrue();
    assertThat(Planner.coverAvailable(contested, context, node)).isFalse();
    var thought = Tactics.think(state, contested, context, new SplittableRandom(1));
    assertThat(thought.state().plan().orElseThrow()).isNotEqualTo(plan);
    assertThat(
            thought
                .note()
                .cover()
                .map(cover -> Planner.coverAvailable(contested, context, cover))
                .orElse(true))
        .isTrue();
  }

  @Test
  void aRouteToArmIsDroppedWhenTheBombHasAlreadyBeenArmed() {
    var id = new BombId(1);
    var bomb =
        new BombView(
            id, new BombOwner.Team(BLUE), new Vec3(30.5, 1, 10.5), new BombState.Armed(100));
    assertThat(afterBombChange(Option.ARM, new PlanStep.Arm(id), bomb).decision().option())
        .isEqualTo(Option.HOLD_ANGLE);
  }

  @Test
  void aRouteToDefuseIsDroppedWhenTheFuseIsNoLongerLit() {
    var id = new BombId(1);
    var bomb =
        new BombView(id, new BombOwner.Team(RED), new Vec3(30.5, 1, 10.5), new BombState.Idle());
    assertThat(afterBombChange(Option.DEFUSE, new PlanStep.Defuse(id), bomb).decision().option())
        .isEqualTo(Option.HOLD_ANGLE);
  }
}
