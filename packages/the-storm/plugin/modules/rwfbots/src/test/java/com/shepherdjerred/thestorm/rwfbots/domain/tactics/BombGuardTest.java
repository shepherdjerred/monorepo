package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
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
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.Set;
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
    var self = combatant(1, RED, BOMB.plus(11, -0.5, 0));
    var enemy = combatant(2, BLUE, BOMB.plus(distance, -0.5, 0)).withVel(vel);
    var bomb = new BombView(new BombId(0), new BombOwner.Team(RED), BOMB, new BombState.Idle());
    var snapshot =
        new WorldSnapshot(
            50,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(bomb),
            PoisonView.NONE,
            NAV.mapId(),
            List.of());
    return new Situation(
        self, snapshot, new Percept(PerceptionState.EMPTY, List.of(enemy), 50), board, role);
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
}
