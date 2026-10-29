package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Sighting;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Suspicion;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** How hard a bot presses a sword fight, whom it faces, and how soon it swings back. */
final class MeleePressureTest {

  private static final long NOW = 100;
  private static final Vec3 HERE = new Vec3(20.5, 1, 20.5);

  @Test
  void aBotPressesInTheBandAndHoldsInsideItRatherThanBackingOff() {
    assertThat(MeleePressure.closing(5, false, false, false)).isEqualTo(1.0);
    assertThat(MeleePressure.closing(2.75, false, false, false)).isPositive();
    assertThat(MeleePressure.closing(2.75, false, false, true)).as("on a ledge").isZero();
    assertThat(MeleePressure.closing(2.0, false, false, true)).as("on a ledge").isNegative();
    assertThat(MeleePressure.closing(2.0, false, false, false)).isZero();
  }

  @Test
  void aHurtOrOutnumberedBotOrOneATeammateCrowdsGivesGround() {
    assertThat(MeleePressure.closing(2.0, false, true, false)).isNegative();
    assertThat(MeleePressure.closing(2.75, false, true, false)).isZero();
    assertThat(MeleePressure.closing(2.0, true, false, false)).isNegative();
  }

  @Test
  void aBotYieldsWhenBadlyHurtOrFacingMoreEnemiesThanItHasTeammatesAround() {
    var self = combatant(1, RED, HERE);
    var one = combatant(2, BLUE, HERE.plus(2, 0, 0));
    var two = combatant(3, BLUE, HERE.plus(-2, 0, 0));
    var ally = combatant(4, RED, HERE.plus(0, 0, 2));
    assertThat(MeleePressure.yields(input(self, List.of(self, one), List.of(one)))).isFalse();
    assertThat(MeleePressure.yields(input(self.withHealth(5, 0), List.of(self, one), List.of(one))))
        .isTrue();
    assertThat(MeleePressure.yields(input(self, List.of(self, one, two), List.of(one, two))))
        .isTrue();
    assertThat(MeleePressure.yields(input(self, List.of(self, ally, one, two), List.of(one, two))))
        .isFalse();
  }

  @Test
  void aBlowTakenPullsTheNextSwingInToAReactionTime() {
    var state = ReflexState.initial(Facing.SOUTH).withClick(NOW + 12, -1);
    var struck = combatant(1, RED, HERE).withLastHurtTick(NOW);
    assertThat(MeleePressure.answer(state, struck, NOW, 3).nextClickAt()).isEqualTo(NOW + 3.0);
    assertThat(MeleePressure.answer(state, combatant(1, RED, HERE), NOW, 3).nextClickAt())
        .isEqualTo(NOW + 12.0);
    var soon = ReflexState.initial(Facing.SOUTH).withClick(NOW + 1, -1);
    assertThat(MeleePressure.answer(soon, struck, NOW, 3).nextClickAt()).isEqualTo(NOW + 1.0);
  }

  @Test
  void anEnemyFeltInContactIsAThreatForASecond() {
    var self = combatant(1, RED, HERE);
    var behind = HERE.plus(0, 0, -2);
    assertThat(ReflexInput.threat(self, felt(behind, NOW - 5))).contains(behind);
    assertThat(ReflexInput.threat(self, felt(behind, NOW - 30))).isEmpty();
    assertThat(ReflexInput.threat(self, felt(HERE.plus(0, 0, -6), NOW - 5))).isEmpty();
  }

  @Test
  void aBotFightsTheEnemyInItsFaceBeforeOneChosenFurtherOff() {
    var self = combatant(1, RED, HERE);
    var chosen = combatant(2, BLUE, HERE.plus(10, 0, 0));
    var inFace = combatant(3, BLUE, HERE.plus(0, 0, 2));
    var percept = new Percept(PerceptionState.EMPTY, List.of(inFace, chosen), NOW);
    assertThat(ReflexInput.resolveTarget(self, decision(self, chosen, Stance.AGGRESSIVE), percept))
        .contains(inFace);
    var near = combatant(2, BLUE, HERE.plus(3, 0, 0));
    var both = new Percept(PerceptionState.EMPTY, List.of(inFace, near), NOW);
    assertThat(ReflexInput.resolveTarget(self, decision(self, near, Stance.AGGRESSIVE), both))
        .as("the chosen one in reach too")
        .contains(near);
  }

  @Test
  void aBotWalkingItsPathTurnsToAnEnemyFeltBehindIt() {
    var self = combatant(1, RED, HERE);
    var behind = HERE.plus(0, 0, -2);
    var world = world(List.of(self));
    var decision =
        new Decision(
            self.id(),
            Option.HOLD_SLOT,
            Optional.empty(),
            List.of(),
            Stance.CAUTIOUS,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "hold_slot:hold",
            NOW,
            1,
            Optional.empty());
    var calm =
        new ReflexInput(self, world, decision, Optional.empty(), 0, List.of(), Optional.empty());
    var felt =
        new ReflexInput(self, world, decision, Optional.empty(), 0, List.of(), Optional.of(behind));
    var context =
        new ReflexContext(
            SyntheticMap.bake(),
            levers(1),
            Loadout.standard(Kit.TROOPER),
            ReflexContext.Habits.NONE);
    var state = ReflexState.initial(Facing.SOUTH);
    var after = state;
    for (var tick = 0; tick < 10; tick++) {
      after = Reflex.tick(after, felt, context, new SplittableRandom(tick)).state();
    }
    var calmed = Reflex.tick(state, calm, context, new SplittableRandom(1)).state();
    var toThreat = Facing.looking(self.eye(), behind.plus(0, 1.3, 0));
    assertThat(after.aim().look().differenceTo(toThreat)).isLessThan(45);
    assertThat(calmed.aim().look().differenceTo(toThreat)).isGreaterThan(135);
  }

  private static Percept felt(Vec3 at, long tick) {
    var memory =
        new Memory(Map.of(new CombatantId(9), new Sighting(at, Vec3.ZERO, tick, 0.9, false, true)));
    return new Percept(new PerceptionState(memory, Suspicion.NONE), List.of(), NOW);
  }

  private static Decision decision(CombatantView self, CombatantView target, Stance stance) {
    return new Decision(
        self.id(),
        Option.ENGAGE,
        Optional.of(target.id()),
        List.of(),
        stance,
        Optional.empty(),
        Optional.of(target.pos()),
        Optional.empty(),
        "engage:fight",
        NOW,
        1,
        Optional.empty());
  }

  private static ReflexInput input(
      CombatantView self, List<CombatantView> everyone, List<CombatantView> seen) {
    var decision = decision(self, seen.getFirst(), Stance.AGGRESSIVE);
    return new ReflexInput(
        self, world(everyone), decision, Optional.of(seen.getFirst()), 0, seen, Optional.empty());
  }

  private static WorldSnapshot world(List<CombatantView> views) {
    return new WorldSnapshot(
        NOW,
        MatchPhase.LIVE,
        views,
        List.of(),
        PoisonView.NONE,
        "synthetic",
        List.of(),
        List.of(),
        List.of());
  }
}
