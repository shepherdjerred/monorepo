package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwfbots.app.Loadouts;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** Steak heals at once, so a hurt bot eats it mid-fight, between swings, and never wastes it. */
final class SteakTest {

  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final int STEAK_SLOT = 1;
  private static final ReflexContext BERSERKER =
      new ReflexContext(
          NAV.grid(), levers(1), Loadout.standard(Kit.BERSERKER).withSteakSlot(STEAK_SLOT));
  private static final BodyCommand EAT = new BodyCommand.Consume(STEAK_SLOT);

  private static WorldSnapshot world(long tick, List<CombatantView> views) {
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        views,
        List.of(),
        PoisonView.NONE,
        "synthetic",
        List.of(),
        List.of(),
        List.of());
  }

  private static Decision fight(CombatantView self, CombatantView target, long tick) {
    return new Decision(
        self.id(),
        Option.ENGAGE,
        Optional.of(target.id()),
        List.of(),
        Stance.AGGRESSIVE,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        "engage:fight",
        tick,
        0,
        Optional.empty());
  }

  private static ReflexInput input(CombatantView self, CombatantView target, long tick) {
    return new ReflexInput(
        self,
        world(tick, List.of(self, target)),
        fight(self, target, 0),
        Optional.of(target),
        0,
        List.of(target));
  }

  private static Reflex.Step tick(ReflexState state, ReflexInput input, ReflexContext ctx) {
    return Reflex.tick(state, input, ctx, new SplittableRandom(3));
  }

  private static CombatantView self(double health) {
    return combatant(1, RED, new Vec3(5.5, 1, 5.5)).withHealth(health, 0);
  }

  /** An enemy too far to swing at, so nothing but the steak competes for the hand. */
  private static CombatantView farEnemy() {
    return combatant(2, BLUE, new Vec3(5.5, 1, 13.5));
  }

  @Test
  void theBotHealsAsMuchAsRwfsSteak() {
    assertThat(Reflex.STEAK_HEAL).isEqualTo(CombatRules.STEAK_HEALTH);
  }

  @Test
  void berserkerAndSacrificialBotsReachForTheirSteaks() {
    assertThat(Loadouts.rwf(Kit.BERSERKER).hasSteak()).isTrue();
    assertThat(Loadouts.rwf(Kit.SACRIFICIAL).hasSteak()).isTrue();
    assertThat(Loadouts.rwf(Kit.TROOPER).hasSteak()).isFalse();
    assertThat(Loadout.standard(Kit.BERSERKER).hasSteak()).isFalse();
  }

  @Test
  void aHurtBotEatsASteakInAFight() {
    var step = tick(ReflexState.initial(Facing.SOUTH), input(self(10), farEnemy(), 50), BERSERKER);

    assertThat(step.commands()).contains(EAT);
  }

  @Test
  void aSteakIsNeverWastedNearFullHealth() {
    var missingLessThanASteak = self(20 - Reflex.STEAK_HEAL + 1).withLastHurtTick(49);

    var step =
        tick(
            ReflexState.initial(Facing.SOUTH),
            input(missingLessThanASteak, farEnemy(), 50),
            BERSERKER);

    assertThat(step.commands()).doesNotContain(EAT);
    assertThat(
            tick(ReflexState.initial(Facing.SOUTH), input(self(20), farEnemy(), 50), BERSERKER)
                .commands())
        .doesNotContain(EAT);
  }

  @Test
  void aBotWithoutSteakEatsNone() {
    var noSteak = new ReflexContext(NAV.grid(), levers(1), Loadout.standard(Kit.BERSERKER));

    var step = tick(ReflexState.initial(Facing.SOUTH), input(self(4), farEnemy(), 50), noSteak);

    assertThat(step.commands()).noneMatch(BodyCommand.Consume.class::isInstance);
  }

  @Test
  void aBigBotEatsAfterAHitButNotWhileHealthy() {
    var tall = new TraversalState(true, 3, 1, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 40, 0);
    var hurt = combatant(1, RED, new Vec3(5.5, 1, 5.5)).withTraversal(tall).withHealth(30, 0);

    var calm = tick(ReflexState.initial(Facing.SOUTH), input(hurt, farEnemy(), 50), BERSERKER);
    var justHit =
        tick(
            ReflexState.initial(Facing.SOUTH),
            input(hurt.withLastHurtTick(45), farEnemy(), 50),
            BERSERKER);

    assertThat(calm.commands()).doesNotContain(EAT);
    assertThat(justHit.commands()).contains(EAT);
  }

  @Test
  void theSteakGoesBetweenSwingsAndOneRightClickApart() {
    var self = self(6);
    var enemy = combatant(2, BLUE, self.pos().plus(0, 0, 2.2));
    var state = ReflexState.initial(Facing.SOUTH);
    var swung = false;
    var eaten = 0;
    var lastEat = -100L;
    for (long tick = 50; tick < 90; tick++) {
      var step = tick(state, input(self, enemy, tick), BERSERKER);
      state = step.state();
      var swings =
          step.commands().stream()
              .anyMatch(c -> c instanceof BodyCommand.Attack || c instanceof BodyCommand.Swing);
      var eats = step.commands().contains(EAT);
      assertThat(swings && eats).as("tick %d swings and eats", tick).isFalse();
      swung |= swings;
      if (eats) {
        assertThat(tick - lastEat).isGreaterThanOrEqualTo(Reflex.STEAK_GAP_TICKS);
        lastEat = tick;
        eaten++;
      }
    }
    assertThat(swung).isTrue();
    assertThat(eaten).isGreaterThan(1);
  }

  @Test
  void noSteakWhileEatingAnApple() {
    var eating = ReflexState.initial(Facing.SOUTH).withEating(40, true);

    var step = tick(eating, input(self(6), farEnemy(), 50), BERSERKER);

    assertThat(step.commands()).doesNotContain(EAT);
  }
}
