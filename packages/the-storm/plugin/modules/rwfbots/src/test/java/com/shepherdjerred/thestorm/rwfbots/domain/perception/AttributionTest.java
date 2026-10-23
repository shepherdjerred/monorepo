package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** A hit tells its victim, and only its victim, who struck and roughly from where. */
final class AttributionTest {

  private static final NavArtifact NAV = SyntheticMap.bake();

  private final Perception perception =
      new Perception(new SenseContext(NAV.grid(), NAV.graph(), NAV.regions(), levers(0.8)));

  /** A red bot at x=10 looking east, so anything west of it is behind its back. */
  private static final CombatantView VICTIM =
      combatant(1, RED, new Vec3(10.5, 1, 5.5)).withFacing(new Facing(-90, 0));

  private static WorldSnapshot world(long tick, List<CombatantView> views, List<Stimulus> sounds) {
    return new WorldSnapshot(
        tick, MatchPhase.LIVE, views, List.of(), PoisonView.NONE, "synthetic", sounds, List.of());
  }

  private Percept hitBy(CombatantView attacker, long seed) {
    var hit = Stimulus.hit(VICTIM.pos(), 10, attacker.id(), VICTIM.id());
    return perception.perceive(
        PerceptionState.EMPTY,
        VICTIM,
        world(10, List.of(VICTIM, attacker), List.of(hit)),
        new SplittableRandom(seed));
  }

  @Test
  void aSwordFromBehindIsPlacedExactlyAndHeldAgainst() {
    var attacker = combatant(2, BLUE, new Vec3(7.5, 1, 5.5));
    var percept = hitBy(attacker, 1);

    assertThat(percept.sees(attacker.id())).as("it struck from behind").isFalse();
    var sighting = percept.state().memory().of(attacker.id()).orElseThrow();
    assertThat(sighting.pos()).isEqualTo(attacker.pos());
    assertThat(sighting.confidence()).isEqualTo(Perception.ATTRIBUTION_CONFIDENCE);
    assertThat(sighting.direct()).isFalse();
    assertThat(percept.state().grudge()).hasValue(new Grudge(attacker.id(), 10, VICTIM.pos()));
  }

  @Test
  void anArrowFromThirtyBlocksIsPlacedWithinTenPercentOfItsRange() {
    var shooter = combatant(2, BLUE, VICTIM.pos().plus(-30, 0, 0));
    var tolerance = 30 * Perception.ATTRIBUTION_ERROR;
    var inexact = 0;
    for (var seed = 0; seed < 50; seed++) {
      var placed = hitBy(shooter, seed).state().memory().of(shooter.id()).orElseThrow().pos();
      assertThat(placed.distance(shooter.pos())).isLessThanOrEqualTo(tolerance + 1e-9);
      assertThat(placed.y()).isCloseTo(shooter.pos().y(), within(1e-9));
      if (placed.distance(shooter.pos()) > 0.1) inexact++;
    }
    assertThat(inexact).as("a long shot is only roughly placed").isGreaterThan(25);
  }

  @Test
  void aTeammateThatWasNotHitLearnsNothingButTheSound() {
    var shooter = combatant(2, BLUE, VICTIM.pos().plus(-30, 0, 0));
    var bystander = combatant(3, RED, VICTIM.pos().plus(0, 0, 4)).withFacing(new Facing(-90, 0));
    var hit = Stimulus.hit(VICTIM.pos(), 10, shooter.id(), VICTIM.id());
    var percept =
        perception.perceive(
            PerceptionState.EMPTY,
            bystander,
            world(10, List.of(VICTIM, bystander, shooter), List.of(hit)),
            new SplittableRandom(1));

    assertThat(percept.state().grudge()).isEmpty();
    assertThat(percept.state().memory().of(shooter.id()))
        .as("it only heard the hit land, by the victim")
        .hasValueSatisfying(
            heard -> {
              assertThat(heard.pos().distance(VICTIM.pos())).isLessThan(5);
              assertThat(heard.confidence()).isEqualTo(Perception.SOUND_CONFIDENCE);
            });
  }

  @Test
  void aTeammatesStrayBlowStartsNoGrudge() {
    var clumsy = combatant(2, RED, new Vec3(8.5, 1, 5.5));
    var percept = hitBy(clumsy, 1);
    assertThat(percept.state().grudge()).isEmpty();
    assertThat(percept.state().memory().of(clumsy.id())).isEmpty();
  }

  @Test
  void theGrudgeLapsesAfterItsWindowAndARepeatHitKeepsItsLeash() {
    var attacker = combatant(2, BLUE, new Vec3(7.5, 1, 5.5));
    var first = hitBy(attacker, 1).state();
    var moved = VICTIM.withPos(VICTIM.pos().plus(0, 0, 6));
    var again = Stimulus.hit(moved.pos(), 60, attacker.id(), VICTIM.id());
    var refreshed =
        perception
            .perceive(
                first,
                moved,
                world(60, List.of(moved, attacker), List.of(again)),
                new SplittableRandom(1))
            .state();
    assertThat(refreshed.grudge()).hasValue(new Grudge(attacker.id(), 60, VICTIM.pos()));

    var later = 60 + Grudge.WINDOW_TICKS;
    var stillAngry =
        perception.perceive(
            refreshed,
            moved,
            world(later, List.of(moved, attacker), List.of()),
            new SplittableRandom(1));
    assertThat(stillAngry.state().grudgeAt(later)).isPresent();
    var calm =
        perception.perceive(
            stillAngry.state(),
            moved,
            world(later + 1, List.of(moved, attacker), List.of()),
            new SplittableRandom(1));
    assertThat(calm.state().grudge()).isEmpty();
    assertThat(calm.state().memory().of(attacker.id()))
        .as("the attacker is still remembered, only the grudge is gone")
        .isPresent();
  }

  @Test
  void anotherAttackerStartsANewGrudgeWhereTheBotNowStands() {
    var grudge = new Grudge(new CombatantId(2), 10, new Vec3(0, 1, 0));
    var here = new Vec3(5, 1, 5);
    assertThat(grudge.hitBy(new CombatantId(3), 20, here))
        .isEqualTo(new Grudge(new CombatantId(3), 20, here));
    assertThat(grudge.hitBy(new CombatantId(2), 10 + Grudge.WINDOW_TICKS + 1, here))
        .as("the same attacker after the window starts afresh")
        .isEqualTo(new Grudge(new CombatantId(2), 10 + Grudge.WINDOW_TICKS + 1, here));
  }
}
