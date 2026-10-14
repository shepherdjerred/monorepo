package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.*;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.*;
import com.shepherdjerred.thestorm.rwfbots.domain.world.*;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class ObjectivePolicyTest {
  private static final Vec3 AT = new Vec3(5.5, 1, 16.5);
  private static final TacticsContext CONTEXT =
      new TacticsContext(
          SyntheticMap.bake(),
          levers(0.5),
          new Style(0.5, 0.5, 0.5, 0.5),
          Kit.TROOPER,
          Archetype.TACTICIAN,
          Set.of(),
          1,
          null);

  private static BombView own(long fuse) {
    return new BombView(
        new BombId(0), new BombOwner.Team(RED), AT.plus(-1, 0.5, 0), new BombState.Armed(fuse));
  }

  @Test
  void noOppositionOnlySuppressesOffenseWhileAnArmedThreatStillNeedsDefusing() {
    var self = combatant(1, RED, AT);
    var target =
        new BombView(
            new BombId(1), new BombOwner.Team(BLUE), AT.plus(5, 0.5, 0), new BombState.Idle());
    assertThat(situation(100, List.of(self), List.of(target)).pendingElimination()).isFalse();
    assertThat(situation(100, List.of(self), List.of(own(800), target)).pendingElimination())
        .isTrue();
    var enemy = combatant(2, BLUE, AT.plus(20, 0, 0));
    assertThat(situation(100, List.of(self, enemy), List.of(own(800), target)).pendingElimination())
        .isFalse();
  }

  private static Situation situation(long tick, List<CombatantView> bodies, List<BombView> bombs) {
    var self = bodies.getFirst();
    var snapshot =
        new WorldSnapshot(
            tick, MatchPhase.LIVE, bodies, bombs, PoisonView.NONE, "synthetic", List.of());
    var visible = bodies.stream().filter(body -> !body.team().equals(self.team())).toList();
    return new Situation(
        self,
        snapshot,
        new Percept(PerceptionState.EMPTY, visible, tick),
        Blackboard.open(RED, Strategy.RUSH),
        Role.DEFEND);
  }

  @Test
  void distantCombatAndNonlethalDamageDoNotBreakTheDefuseCommitment() {
    var self = combatant(1, RED, AT).withLastHurtTick(99);
    var enemy = combatant(2, BLUE, AT.plus(10, 0, 0));
    var memory = TacticalMemory.EMPTY.objective(Optional.of(new BombId(0)), Optional.empty(), 50);
    var result =
        ObjectivePolicy.direct(
            memory, situation(100, List.of(self, enemy), List.of(own(600))), CONTEXT);
    assertThat(result.forced()).contains(Option.DEFUSE);
    assertThat(result.memory().defusing()).contains(new BombId(0));
  }

  @Test
  void aNewSafeAssignmentStartsImmediatelyInsteadOfPretendingItWasInterrupted() {
    var self = combatant(1, RED, AT);
    var result =
        ObjectivePolicy.direct(
            TacticalMemory.EMPTY, situation(100, List.of(self), List.of(own(600))), CONTEXT);
    assertThat(result.forced()).contains(Option.DEFUSE);
    assertThat(result.memory().defusing()).contains(new BombId(0));
  }

  @Test
  void immediateMeleeInterruptsAndRequires750MillisOfSafetyBeforeResuming() {
    var self = combatant(1, RED, AT);
    var enemy = combatant(2, BLUE, AT.plus(2, 0, 0));
    var memory = TacticalMemory.EMPTY.objective(Optional.of(new BombId(0)), Optional.empty(), 50);
    var interrupted =
        ObjectivePolicy.direct(
            memory, situation(100, List.of(self, enemy), List.of(own(600))), CONTEXT);
    assertThat(interrupted.forced()).contains(Option.ENGAGE);
    var safe = List.of(self, enemy.withPos(AT.plus(12, 0, 0)));
    var waiting =
        ObjectivePolicy.direct(
            interrupted.memory(), situation(101, safe, List.of(own(600))), CONTEXT);
    assertThat(waiting.forced()).contains(Option.HOLD_ANGLE);
    assertThat(
            ObjectivePolicy.direct(
                    waiting.memory(), situation(115, safe, List.of(own(600))), CONTEXT)
                .forced())
        .contains(Option.HOLD_ANGLE);
    assertThat(
            ObjectivePolicy.direct(
                    waiting.memory(), situation(116, safe, List.of(own(600))), CONTEXT)
                .forced())
        .contains(Option.DEFUSE);
  }

  @Test
  void onlyPrimaryAndUsefulAssistantRespondWhileOneOtherGuards() {
    var team =
        List.of(
            combatant(1, RED, AT),
            combatant(2, RED, AT.plus(1, 0, 1)),
            combatant(3, RED, AT.plus(2, 0, 1)),
            combatant(4, RED, AT.plus(3, 0, 1)));
    var responders = 0;
    var guards = 0;
    for (var self : team) {
      var bodies = new java.util.ArrayList<CombatantView>();
      bodies.add(self);
      team.stream().filter(other -> !other.id().equals(self.id())).forEach(bodies::add);
      var frame = situation(100, bodies, List.of(own(600)));
      if (ObjectivePolicy.responds(frame, CONTEXT)) responders++;
      if (ObjectivePolicy.guards(frame, CONTEXT)) guards++;
    }
    assertThat(responders).isEqualTo(2);
    assertThat(guards).isEqualTo(1);
  }

  @Test
  void nearbyPlantNeedsBothRoutesBothTasksAndFiveSecondReserve() {
    var self = combatant(1, RED, AT);
    var enemy = combatant(2, BLUE, AT.plus(20, 0, 0));
    var target =
        new BombView(
            new BombId(1), new BombOwner.Team(BLUE), AT.plus(5, 0.5, 0), new BombState.Idle());
    assertThat(
            ObjectivePolicy.detour(
                situation(100, List.of(self, enemy), List.of(own(800), target)), CONTEXT))
        .contains(target);
    assertThat(
            ObjectivePolicy.detour(
                situation(100, List.of(self, enemy), List.of(own(300), target)), CONTEXT))
        .isEmpty();
    assertThat(
            ObjectivePolicy.detour(
                situation(100, List.of(self), List.of(own(800), target)), CONTEXT))
        .isEmpty();
  }

  @Test
  void hostileNukeIsAnOwnThreatAndExpiredUnreachableGoalsCanBeRetried() {
    var nuke =
        new BombView(
            new BombId(2),
            new BombOwner.Nuke(Optional.of(BLUE)),
            AT.plus(4, 0.5, 0),
            new BombState.Armed(400));
    assertThat(situation(100, List.of(combatant(1, RED, AT)), List.of(nuke)).litOwnBomb())
        .contains(nuke);
    assertThat(nuke.threatens(BLUE)).isFalse();
    var memory = TacticalMemory.EMPTY.blocked(nuke.pos(), 100);
    assertThat(memory.excludes(nuke.pos(), 199)).isTrue();
    assertThat(memory.excludes(nuke.pos(), 200)).isFalse();
  }
}
