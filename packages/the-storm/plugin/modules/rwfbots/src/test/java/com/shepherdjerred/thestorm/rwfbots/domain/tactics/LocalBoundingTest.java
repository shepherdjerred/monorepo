package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class LocalBoundingTest {
  private static final Vec3 HERE = new Vec3(20.5, 1, 20.5);

  @Test
  void aDistantHomeDefenderDoesNotMakeAnUncoveredFlankerWait() {
    var situation = squad(HERE.plus(-20, 0, 0));
    assertThat(situation.board().plan().partners(situation.self().id())).hasSize(1);
    assertThat(Planner.mover(situation, 1)).isTrue();
  }

  @Test
  void nearbySquadMembersStillAlternateBoundsWhileDifferentFloorsDoNot() {
    var nearby = squad(HERE.plus(-4, 0, 0));
    assertThat(Planner.mover(nearby, 0)).isTrue();
    assertThat(Planner.mover(nearby, 1)).isFalse();
    assertThat(Planner.mover(squad(HERE.plus(-4, 4, 0)), 1)).isTrue();
  }

  private static Situation squad(Vec3 defenderPosition) {
    var self = combatant(1, RED, HERE);
    var defender = combatant(2, RED, defenderPosition);
    var flank =
        new Slot(
            "flank",
            SlotKind.FLANK,
            Role.ROTATE,
            HERE.plus(20, 0, 0),
            HERE,
            -1,
            -1,
            Optional.empty(),
            0);
    var home =
        new Slot(
            "home",
            SlotKind.ANCHOR,
            Role.DEFEND,
            defenderPosition,
            HERE,
            -1,
            -1,
            Optional.empty(),
            0);
    var plan =
        new TeamPlan(
            Optional.of(Strategy.TURTLE),
            Optional.of(defenderPosition),
            Optional.empty(),
            List.of(),
            0.5,
            List.of(flank, home),
            Map.of(self.id(), flank.key(), defender.id(), home.key()),
            0,
            Map.of(self.id(), 0, defender.id(), 0));
    var snapshot =
        new WorldSnapshot(
            40,
            MatchPhase.LIVE,
            List.of(self, defender),
            List.of(),
            PoisonView.NONE,
            "test",
            List.of());
    return new Situation(
        self,
        snapshot,
        new Percept(PerceptionState.EMPTY, List.of(), 40),
        Blackboard.open(RED, Strategy.TURTLE).withPlan(plan, 0),
        Role.ROTATE);
  }
}
