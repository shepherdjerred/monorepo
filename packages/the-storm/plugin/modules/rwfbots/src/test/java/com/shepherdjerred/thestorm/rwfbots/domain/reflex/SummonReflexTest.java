package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Grudge;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Suspicion;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.SummonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/**
 * The reflex layer fights a dog that closes and shoots a golem, but never trades blows with one.
 */
final class SummonReflexTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final Vec3 HERE = new Vec3(6.5, 1, 6.5);

  private static SummonView summon(int id, SummonView.Kind kind, Vec3 pos) {
    return new SummonView(new CombatantId(id), kind, BLUE, pos, Vec3.ZERO, 20);
  }

  private static Percept percept(Optional<Grudge> grudge, SummonView... summons) {
    return new Percept(
        new PerceptionState(Memory.EMPTY, Suspicion.NONE, -1, grudge),
        List.of(),
        100,
        List.of(summons));
  }

  private static Decision fleeing(CombatantView self) {
    return new Decision(
        self.id(),
        Option.RETREAT,
        Optional.empty(),
        List.of(),
        Stance.EVASIVE,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        "retreat:flee",
        100,
        0,
        Optional.empty());
  }

  private static CombatantView self(Kit kit, Vec3 lookAt) {
    var base = combatant(1, RED, HERE);
    var self =
        new CombatantView(
            base.id(),
            base.team(),
            false,
            kit,
            true,
            base.pos(),
            Vec3.ZERO,
            0,
            0,
            20,
            0,
            15,
            0,
            false,
            true,
            false,
            false,
            -1,
            base.traversal(),
            base.quiver());
    return self.withFacing(Facing.looking(self.eye(), lookAt));
  }

  private static Reflex.Step tick(CombatantView self, Decision decision, SummonView summon) {
    var snapshot =
        new WorldSnapshot(
            100,
            MatchPhase.LIVE,
            List.of(self),
            List.of(),
            PoisonView.NONE,
            NAV.mapId(),
            List.of(),
            List.of(),
            List.of(summon));
    var input = ReflexInput.of(self, snapshot, decision, percept(Optional.empty(), summon));
    return Reflex.tick(
        ReflexState.initial(self.facing()),
        input,
        new ReflexContext(NAV.grid(), levers(1), Loadout.standard(self.kit())),
        new SplittableRandom(4));
  }

  @Test
  void aDogInReachIsFought() {
    var wolf = summon(5, SummonView.Kind.WOLF, HERE.plus(2, 0, 0));
    var self = self(Kit.TROOPER, wolf.pos().plus(0, 1.3, 0));
    var step = tick(self, Decision.idle(self.id(), 100, 0), wolf);
    assertThat(step.commands()).contains(new BodyCommand.Attack(wolf.id()));
  }

  @Test
  void aSwordNeverTakesOnAGolemAndOnlyFendsOneOffWhileRunning() {
    var golem = summon(5, SummonView.Kind.GOLEM, HERE.plus(2.5, 0, 0));
    var sword = self(Kit.TROOPER, golem.centre());
    var holding = Decision.idle(sword.id(), 100, 0);
    assertThat(ReflexInput.resolveSummon(sword, holding, percept(Optional.empty(), golem)))
        .isEmpty();
    assertThat(tick(sword, holding, golem).commands())
        .noneMatch(BodyCommand.Attack.class::isInstance);
    assertThat(ReflexInput.resolveSummon(sword, fleeing(sword), percept(Optional.empty(), golem)))
        .as("while it runs it keeps the golem in view")
        .contains(golem);
  }

  @Test
  void anArcherDrawsOnAGolemOutOfItsReach() {
    var golem = summon(5, SummonView.Kind.GOLEM, HERE.plus(12, 0, 0));
    var archer = self(Kit.LONGBOW, golem.centre());
    var step = tick(archer, Decision.idle(archer.id(), 100, 0), golem);
    assertThat(step.commands()).contains(new BodyCommand.StartUse());
    var upon = summon(5, SummonView.Kind.GOLEM, HERE.plus(3, 0, 0));
    assertThat(
            ReflexInput.resolveSummon(
                archer, Decision.idle(archer.id(), 100, 0), percept(Optional.empty(), upon)))
        .as("inside its reach a golem is run from, not shot")
        .isEmpty();
  }

  @Test
  void theDogThatBitTheBotIsFoughtBeforeANearerOneAndADistantDogIsLeftBe() {
    var self = self(Kit.TROOPER, HERE.plus(1, 0, 0));
    var idle = Decision.idle(self.id(), 100, 0);
    var near = summon(5, SummonView.Kind.WOLF, HERE.plus(2, 0, 0));
    var biter = summon(6, SummonView.Kind.WOLF, HERE.plus(0, 0, 3.5));
    assertThat(ReflexInput.resolveSummon(self, idle, percept(Optional.empty(), near, biter)))
        .contains(near);
    var bitten = Optional.of(new Grudge(biter.id(), 95, HERE));
    assertThat(ReflexInput.resolveSummon(self, idle, percept(bitten, near, biter))).contains(biter);
    var far = summon(7, SummonView.Kind.WOLF, HERE.plus(9, 0, 0));
    assertThat(ReflexInput.resolveSummon(self, idle, percept(Optional.empty(), far))).isEmpty();
  }
}
