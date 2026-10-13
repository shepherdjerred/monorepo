package com.shepherdjerred.thestorm.rwf.domain.ability;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Rewind;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.RewindTrail;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The Rewind kit's Time Machine, as Red Warfare's RewinderAbility ran it. */
final class RewindTest {

  private static Vec3 at(int second) {
    return new Vec3(second, 64, 0);
  }

  /** Standing at {@code at(second)}, facing yaw {@code second} and pitch {@code -second}. */
  private static Motion standing(int second) {
    return new Motion(
        at(second), Vec3.ZERO, second, -second, false, false, true, 20, 20, false, false, true);
  }

  private static Bout bout() {
    var bout = new Bout().with(ALICE, TeamColor.RED, "rewind").with(BOB, TeamColor.BLUE, "trooper");
    bout.start();
    return bout;
  }

  /** Walks Alice one block a second for {@code seconds}, ticking every 50 ms. */
  private static void walk(Bout bout, int seconds) {
    for (var tick = 0; tick < seconds * 20; tick++) {
      bout.tick(Bout.motions(Map.of(ALICE, standing(tick / 20))));
      bout.advance(Duration.ofMillis(50));
    }
  }

  @Test
  void pinsTheOriginalConstantsAndWords() {
    assertThat(Rewind.ID).isEqualTo("rewind");
    assertThat(Rewind.COOLDOWN).isEqualTo(Duration.ofSeconds(30));
    assertThat(RewindTrail.WINDOW).isEqualTo(Duration.ofSeconds(30));
    assertThat(Rewind.UNSTABLE)
        .isEqualTo("Your timestream is too unstable! Attempting to use it now would kill you!");
    assertThat(Rewind.NO_LANDING).isEqualTo("No landing spots found in the last 10 seconds!");
    assertThat(AbilityBook.byId("rewind")).containsInstanceOf(Rewind.class);
  }

  @Test
  void theClockStartsOnCooldownShownOnTheExperienceBar() {
    var bout = new Bout().with(ALICE, TeamColor.RED, "rewind");

    assertThat(bout.start())
        .containsExactly(new AbilityEffect.Cooldown(ALICE, Rewind.ID, Rewind.COOLDOWN));
    assertThat(bout.abilities.ready(ALICE, Rewind.ID, bout.now.plusSeconds(29))).isFalse();
    assertThat(bout.abilities.ready(ALICE, Rewind.ID, bout.now.plusSeconds(30))).isTrue();
  }

  @Test
  void usingItWhileItRechargesIsRefusedInRed() {
    var bout = bout();
    walk(bout, 2);

    assertThat(bout.act(ALICE, new AbilityInput.Rewind()))
        .containsExactly(
            new AbilityEffect.Say(List.of(ALICE), Rewind.UNSTABLE, AbilityEffect.Tone.REFUSED));
    assertThat(
            Rewind.refusal(
                bout.abilities.ready(ALICE, Rewind.ID, bout.now),
                bout.state(ALICE, Rewind.Clock.class)))
        .contains(Rewind.Refusal.COOLING_DOWN);
  }

  @Test
  void withNoSafeSpotThereIsNowhereToLand() {
    var bout = bout();
    bout.ground = feet -> false;
    walk(bout, 31);

    assertThat(bout.act(ALICE, new AbilityInput.Rewind()))
        .containsExactly(
            new AbilityEffect.Say(List.of(ALICE), Rewind.NO_LANDING, AbilityEffect.Tone.REFUSED));
  }

  @Test
  void itLandsWhereThePlayerStoodAboutThirtySecondsAgoFacingTheSameWay() {
    var bout = bout();
    walk(bout, 40);

    var effects = bout.act(ALICE, new AbilityInput.Rewind());

    // The oldest kept sample is the last one whose successor is still inside the 30 s window.
    assertThat(effects)
        .containsExactly(
            new AbilityEffect.Cooldown(ALICE, Rewind.ID, Rewind.COOLDOWN),
            new AbilityEffect.TimeTravel(ALICE, new RewindTrail.Spot(at(9), 9, -9)));
    assertThat(bout.state(ALICE, Rewind.Clock.class).trail().samples()).isEmpty();
    assertThat(bout.abilities.ready(ALICE, Rewind.ID, bout.now.plusSeconds(29))).isFalse();
  }

  @Test
  void anOldSafeSpotIsKeptWhileTheSpotAfterItHasBecomeUnsafe() {
    var bout = bout();
    walk(bout, 2);
    // The spots of the second second have since been blown away.
    bout.ground = feet -> feet.x() != 1;
    for (var tick = 0; tick < 40 * 20; tick++) {
      bout.tick(Bout.motions(Map.of(ALICE, standing(5))));
      bout.advance(Duration.ofMillis(50));
    }

    var landing = bout.state(ALICE, Rewind.Clock.class).trail().landing();
    assertThat(landing.map(RewindTrail.Spot::position)).contains(at(0));
  }

  @Test
  void dyingForgetsTheTrail() {
    var bout = bout();
    walk(bout, 5);

    bout.die(ALICE, Optional.of(BOB), Map.of());

    assertThat(bout.state(ALICE, Rewind.Clock.class).trail().samples()).isEmpty();
  }
}
