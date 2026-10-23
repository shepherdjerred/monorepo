package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
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
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class CrouchControlTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final Vec3 HERE = new Vec3(5.5, 1, 5.5);

  private static Reflex.Step step(ReflexState state, Stance stance, long tick, boolean quirk) {
    var self = combatant(1, RED, HERE);
    var moving = stance == Stance.AGGRESSIVE;
    var decision =
        new Decision(
            self.id(),
            moving ? Option.TAKE_SLOT : Option.HOLD_ANGLE,
            Optional.empty(),
            moving ? List.of(new Waypoint(HERE.plus(8, 0, 0), Hop.WALK)) : List.of(),
            stance,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "crouch-transition",
            tick,
            0,
            Optional.empty());
    var snapshot =
        new WorldSnapshot(
            tick,
            MatchPhase.LIVE,
            List.of(self),
            List.of(),
            PoisonView.NONE,
            NAV.mapId(),
            List.of(),
            List.of(),
            List.of());
    return Reflex.tick(
        state,
        new ReflexInput(self, snapshot, decision, Optional.empty(), 3, List.of()),
        new ReflexContext(
            NAV.grid(),
            levers(1),
            Loadout.standard(Kit.TROOPER),
            new ReflexContext.Habits(quirk, Reflex.EAT_BELOW)),
        new SplittableRandom(7));
  }

  @Test
  void ordinaryMovementAndStandingExplicitlyReleaseAPreviousStealthCrouchWithoutAQuirk() {
    var waiting =
        step(ReflexState.initial(combatant(1, RED, HERE).facing()), Stance.STEALTH, 1, false);
    assertThat(waiting.commands()).contains(new BodyCommand.Sneak(true));
    for (var stance : List.of(Stance.AGGRESSIVE, Stance.CAUTIOUS)) {
      var next = step(waiting.state(), stance, 2, false);
      assertThat(next.commands()).contains(new BodyCommand.Sneak(false));
      assertThat(next.commands()).doesNotContain(new BodyCommand.Sneak(true));
      if (stance == Stance.AGGRESSIVE)
        assertThat(next.commands()).contains(new BodyCommand.MoveToward(HERE.plus(8, 0, 0), true));
    }
  }

  @Test
  void rhythmicIdleTappingRemainsOptionalAndStealthStillCrouchesBetweenTaps() {
    var initial = ReflexState.initial(combatant(1, RED, HERE).facing());
    assertThat(step(initial, Stance.CAUTIOUS, 1, true).commands())
        .contains(new BodyCommand.Sneak(true));
    assertThat(step(initial, Stance.CAUTIOUS, 3, true).commands())
        .contains(new BodyCommand.Sneak(false));
    assertThat(step(initial, Stance.CAUTIOUS, 1, false).commands())
        .contains(new BodyCommand.Sneak(false));
    assertThat(step(initial, Stance.STEALTH, 3, true).commands())
        .contains(new BodyCommand.Sneak(true));
  }
}
