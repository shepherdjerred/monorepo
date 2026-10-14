package com.shepherdjerred.thestorm.rwf.domain.match;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitAccess;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitPool;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class MatchKitPoolTest {
  @Test
  void aPoolCannotNameMissingContentOrGrantAnUnavailableDefaultKit() {
    assertThatThrownBy(() -> new KitPool(Set.of("unknown")))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new KitPool(Set.of("berserker")))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(new KitPool(Set.of("longbow", "berserker")).defaultKit()).isEqualTo("longbow");
  }

  @Test
  void humansAndOperatorPicksObeyTheSamePoolWithoutBypassingOwnership() {
    var play =
        new Play(
            Play.SETTINGS.withKitPool(new KitPool(Set.of("trooper", "berserker"))), Samples.T0);
    play.join(ALICE);
    assertThat(play.refused(new MatchEvent.PickKit(ALICE, "longbow", KitAccess.EVERYTHING)))
        .isEqualTo(MatchError.KIT_LOCKED);
    assertThat(play.refused(new MatchEvent.ForceKit(ALICE, "longbow")))
        .isEqualTo(MatchError.KIT_LOCKED);
    assertThat(play.refused(new MatchEvent.PickKit(ALICE, "berserker", KitAccess.MILESTONE_ONE)))
        .isEqualTo(MatchError.KIT_LOCKED);
    play.ok(new MatchEvent.PickKit(ALICE, "trooper", KitAccess.MILESTONE_ONE));
    assertThat(play.member(ALICE).kit()).contains("trooper");
  }

  @Test
  void unpickedHumansStartWithTheAdmittedFreeKitAndCopiesPreserveThePool() {
    var pool = new KitPool(Set.of("longbow"));
    var settings =
        Play.SETTINGS
            .withKitPool(pool)
            .withMaxPlayers(64)
            .withFlow(
                java.time.Duration.ZERO, java.time.Duration.ZERO, java.time.Duration.ZERO, false);
    var play = new Play(settings, Samples.T0);
    play.start(Samples.twoTeams(), ALICE, BOB);
    assertThat(play.member(ALICE).kit()).contains("longbow");
    assertThat(play.member(BOB).kit()).contains("longbow");
    assertThat(play.match.settings().kitPool()).isEqualTo(pool);
  }
}
