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
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Suspicion;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamNote;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** Guards answer an enemy on its way to their bomb, not only one already beside it. */
final class BombGuardTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final Vec3 BOMB = SyntheticMap.RED_BOMB.center();
  private static final CombatantId ENEMY = new CombatantId(2);
  private static final TacticsContext CONTEXT =
      new TacticsContext(
          NAV,
          levers(0.5),
          new Style(0.5, 0.5, 0.5, 0.5),
          Kit.TROOPER,
          Archetype.ANCHOR,
          Set.of(),
          42,
          null);

  /** A red guard 11 blocks east of its bomb, with an enemy {@code distance} further east. */
  private static Situation situation(Role role, double distance, Vec3 vel, Blackboard board) {
    return guard(1, role, board, approaching(distance, vel));
  }

  /** The enemy {@code distance} east of the bomb, moving at {@code vel}. */
  private static CombatantView approaching(double distance, Vec3 vel) {
    return combatant(ENEMY.value(), BLUE, BOMB.plus(distance, -0.5, 0)).withVel(vel);
  }

  /** Red guard {@code id}, 11 blocks east of its bomb, seeing {@code enemies}. */
  private static Situation guard(int id, Role role, Blackboard board, CombatantView... enemies) {
    var self = combatant(id, RED, BOMB.plus(11, -0.5, 0));
    var bomb = new BombView(new BombId(0), new BombOwner.Team(RED), BOMB, new BombState.Idle());
    var views = new ArrayList<CombatantView>();
    views.add(self);
    views.addAll(List.of(enemies));
    var snapshot =
        new WorldSnapshot(
            50,
            MatchPhase.LIVE,
            views,
            List.of(bomb),
            PoisonView.NONE,
            NAV.mapId(),
            List.of(),
            List.of(),
            List.of());
    return new Situation(
        self, snapshot, new Percept(PerceptionState.EMPTY, List.of(enemies), 50), board, role);
  }

  /** {@code board} once guard {@code situation} has committed {@code plan}. */
  private static Blackboard commit(Blackboard board, Situation situation, Plan plan) {
    var decision = Planner.decide(plan, situation, CONTEXT, 0);
    return board.note(situation.self().id(), Tactics.note(plan, decision, situation, CONTEXT));
  }

  private static Vec3 post(Plan plan) {
    return ((PlanStep.Hold) plan.steps().getLast()).pos();
  }

  private static Situation situation(Role role, double distance, Vec3 vel) {
    return situation(role, distance, vel, Blackboard.open(RED, Strategy.TURTLE));
  }

  private static final Vec3 TOWARDS = new Vec3(-0.2, 0, 0);

  private static boolean answers(Situation situation) {
    return Features.of(situation, CONTEXT, Optional.empty(), false).enemyApproachingOwnBomb();
  }

  @Test
  void aDefenderAnswersAnEnemyApproachingTheBombFromBeyondTheThreatRange() {
    var situation = situation(Role.DEFEND, 24, TOWARDS);
    assertThat(situation.nearestEnemy().orElseThrow().pos().distance(BOMB))
        .isGreaterThan(Features.BOMB_THREAT_RANGE);
    assertThat(answers(situation)).isTrue();
    assertThat(Features.of(situation, CONTEXT, Optional.empty(), false).enemyNearOwnBomb())
        .isFalse();
    assertThat(BombGuard.approach(situation).orElseThrow().enemy()).isEqualTo(ENEMY);
  }

  @Test
  void anEnemyLeavingOrBeyondGuardRangeIsLetGo() {
    assertThat(answers(situation(Role.DEFEND, 24, TOWARDS.scale(-1)))).isFalse();
    assertThat(answers(situation(Role.DEFEND, BombGuard.GUARD_RANGE + 2, TOWARDS))).isFalse();
  }

  @Test
  void onlyGuardsAnswer() {
    assertThat(answers(situation(Role.ROTATE, 24, TOWARDS))).isFalse();
    assertThat(answers(situation(Role.PLANT, 24, TOWARDS))).isFalse();
    assertThat(answers(situation(Role.RETAKE, 24, TOWARDS))).isTrue();
  }

  @Test
  void noMoreThanTwoGuardsAnswerOneEnemy() {
    var board = Blackboard.open(RED, Strategy.TURTLE);
    for (var id = 3; id <= 4; id++) {
      board =
          board.note(
              new CombatantId(id), new TeamNote(Optional.empty(), Optional.of(ENEMY), Set.of()));
    }
    assertThat(answers(situation(Role.DEFEND, 24, TOWARDS, board))).isFalse();
  }

  @Test
  void aGuardMeetsTheEnemyOnTheRingOnItsSideOfTheBombAndWatchesIt() {
    var situation = situation(Role.DEFEND, 24, TOWARDS);
    var plan = Planner.expand(Option.RETAKE, situation, CONTEXT);
    assertThat(plan.steps()).hasSize(2);
    var hold = (PlanStep.Hold) plan.steps().getLast();
    assertThat(hold.pos().distance(BOMB)).isLessThan(Planner.RETAKE_RING + Planner.SNAP);
    // East of the bomb, towards the enemy, never further out than the guard already stands.
    assertThat(hold.pos().x()).isGreaterThan(BOMB.x());
    assertThat(hold.pos().distance(BOMB)).isLessThan(situation.self().pos().distance(BOMB));
    assertThat(Planner.decide(Plan.of(Option.RETAKE, 50, hold), situation, CONTEXT, 0).watch())
        .contains(situation.percept().visible().getFirst().pos());
  }

  @Test
  void anEnemyAtTheBombOrUpCloseIsStillFought() {
    var plan = Planner.expand(Option.RETAKE, situation(Role.DEFEND, 10, TOWARDS), CONTEXT);
    assertThat(plan.current()).isEqualTo(new PlanStep.Fight(ENEMY));
    var close = Planner.expand(Option.RETAKE, situation(Role.DEFEND, 16, TOWARDS), CONTEXT);
    assertThat(close.current()).isEqualTo(new PlanStep.Fight(ENEMY));
  }

  @Test
  void threeGuardsDecidingInOneCycleLeaveTheThirdOut() {
    // Every guard plans against the board as it stood at the start of the cycle.
    var start = Blackboard.open(RED, Strategy.TURTLE);
    var ids = List.of(1, 3, 5);
    var proposals = new ArrayList<Plan>();
    for (var id : ids) {
      var plan =
          Planner.expand(
              Option.RETAKE, guard(id, Role.DEFEND, start, approaching(24, TOWARDS)), CONTEXT);
      assertThat(plan.answer()).map(Plan.Answer::enemy).contains(ENEMY);
      proposals.add(plan);
    }
    // They commit one after another; a proposal the board has moved past is re-planned.
    var board = start;
    var posts = new ArrayList<Vec3>();
    for (var i = 0; i < ids.size(); i++) {
      var id = ids.get(i);
      var now = guard(id, Role.DEFEND, board, approaching(24, TOWARDS));
      var plan = proposals.get(i);
      if (!BombGuard.admitted(plan, now.self().id(), board, now.now())) {
        plan = Planner.expand(Option.RETAKE, now, CONTEXT);
      }
      assertThat(BombGuard.admitted(plan, now.self().id(), board, now.now())).isTrue();
      if (plan.answer().isPresent()) posts.add(post(plan));
      board = commit(board, now, plan);
    }
    assertThat(board.chasers(ENEMY, new CombatantId(99))).isEqualTo(Situation.MAX_CHASERS);
    assertThat(posts).hasSize(2);
    assertThat(posts.getFirst().distance(posts.getLast())).isGreaterThan(1);
  }

  @Test
  void twoGuardsWithEvenIdsTakeOppositeSidesOfTheEnemysBearing() {
    var board = Blackboard.open(RED, Strategy.TURTLE);
    var first = guard(4, Role.DEFEND, board, approaching(24, TOWARDS));
    var firstPlan = Planner.expand(Option.RETAKE, first, CONTEXT);
    board = commit(board, first, firstPlan);
    var second = guard(6, Role.DEFEND, board, approaching(24, TOWARDS));
    var secondPlan = Planner.expand(Option.RETAKE, second, CONTEXT);
    assertThat(firstPlan.answer()).contains(new Plan.Answer(ENEMY, new BombId(0), 0));
    assertThat(secondPlan.answer()).contains(new Plan.Answer(ENEMY, new BombId(0), 1));
    assertThat(post(firstPlan).distance(post(secondPlan))).isGreaterThan(1);
    assertThat(post(firstPlan).x()).isGreaterThan(BOMB.x());
    assertThat(post(secondPlan).x()).isGreaterThan(BOMB.x());
  }

  @Test
  void aGuardsNoteNamesTheEnemyItsPlanMeetsEvenWhenAnotherIsNowNearer() {
    var board = Blackboard.open(RED, Strategy.TURTLE);
    var plan =
        Planner.expand(
            Option.RETAKE, guard(1, Role.DEFEND, board, approaching(24, TOWARDS)), CONTEXT);
    var other = combatant(7, BLUE, BOMB.plus(-18, -0.5, 0)).withVel(TOWARDS.scale(-1));
    var later = guard(1, Role.DEFEND, board, approaching(24, TOWARDS), other);
    assertThat(BombGuard.approach(later).orElseThrow().enemy()).isEqualTo(other.id());
    var note = Tactics.note(plan, Planner.decide(plan, later, CONTEXT, 0), later, CONTEXT);
    assertThat(note.chasing()).contains(ENEMY);
  }

  /** A guard's plan answering the enemy approaching from 24 blocks east, made a few ticks ago. */
  private static Plan answering() {
    var plan = Planner.expand(Option.RETAKE, situation(Role.DEFEND, 24, TOWARDS), CONTEXT);
    assertThat(plan.answer()).map(Plan.Answer::enemy).contains(ENEMY);
    return plan.since(45);
  }

  /** The guard thinking with {@code plan} still young and under way. */
  private static Thought think(Plan plan, Situation situation) {
    var state =
        new TacticsState(Optional.of(plan), 45, 1, 0, RewindClock.UNSTARTED, TacticalMemory.EMPTY);
    return Tactics.think(state, situation, CONTEXT, new SplittableRandom(1));
  }

  /** Red guard 1 that last heard the enemy 24 blocks east a second ago, and now sees no one. */
  private static Situation heard(boolean alive) {
    var self = combatant(1, RED, BOMB.plus(11, -0.5, 0));
    var enemy = approaching(24, TOWARDS).withAlive(alive);
    var bomb = new BombView(new BombId(0), new BombOwner.Team(RED), BOMB, new BombState.Idle());
    var snapshot =
        new WorldSnapshot(
            50,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(bomb),
            PoisonView.NONE,
            NAV.mapId(),
            List.of(),
            List.of(),
            List.of());
    var memory = Memory.EMPTY.remember(ENEMY, new Sighting(enemy.pos(), TOWARDS, 30, 1, false));
    var perception = new PerceptionState(memory, Suspicion.NONE);
    return new Situation(
        self,
        snapshot,
        new Percept(perception, List.of(), 50),
        Blackboard.open(RED, Strategy.TURTLE),
        Role.DEFEND);
  }

  @Test
  void aGuardPlanContinuesWhileItsEnemyStillApproaches() {
    var plan = answering();
    assertThat(BombGuard.stillAnswering(plan, situation(Role.DEFEND, 20, TOWARDS))).isTrue();
    assertThat(BombGuard.stillAnswering(plan, heard(true))).isTrue();
  }

  @Test
  void aGuardPlanEndsWhenItsEnemyTurnsAwayLeavesRangeOrDies() {
    var plan = answering();
    var away = situation(Role.DEFEND, 24, TOWARDS.scale(-1));
    var gone = situation(Role.DEFEND, BombGuard.GUARD_RANGE + 2, TOWARDS);
    var dead = heard(false);
    var lost = guard(1, Role.DEFEND, Blackboard.open(RED, Strategy.TURTLE));
    for (var now : List.of(away, gone, dead, lost)) {
      assertThat(BombGuard.stillAnswering(plan, now)).isFalse();
      // The young plan is not kept: the guard re-decides rather than holding the stale point.
      assertThat(think(plan, now).state().plan().orElseThrow().answer()).isEmpty();
    }
  }

  @Test
  void aGuardPlanEndsWhenTheBotNoLongerGuards() {
    assertThat(BombGuard.stillAnswering(answering(), situation(Role.ROTATE, 20, TOWARDS)))
        .isFalse();
  }
}
