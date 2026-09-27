package com.shepherdjerred.thestorm.tracks.domain;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.GOVERNOR;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.boughtAt;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.app.Track;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;

final class AdminChangesTest {

  @ParameterizedTest
  @ValueSource(ints = {1, 2, 3, 4, 5})
  void settingAnyLevelOnANewPlayerMakesThatTrackPrimary(int level) {
    var result = AdminChanges.set(TrackProgress.empty(), ENGINEER, level);

    assertThat(result).isEqualTo(Result.ok(owning(ENGINEER, level)));
  }

  @Test
  void settingZeroOnANewPlayerChangesNothing() {
    assertThat(AdminChanges.set(TrackProgress.empty(), ENGINEER, 0))
        .isEqualTo(Result.ok(TrackProgress.empty()));
  }

  @Test
  void levelsMaySkipAheadAndGoDown() {
    assertThat(AdminChanges.set(owning(MECHANIC, 1), MECHANIC, 5))
        .isEqualTo(Result.ok(owning(MECHANIC, 5)));
    assertThat(AdminChanges.set(owning(MECHANIC, 5), MECHANIC, 2))
        .isEqualTo(Result.ok(owning(MECHANIC, 2)));
  }

  @Test
  void aSecondaryMayBeSetUpToThePrimary() {
    assertThat(AdminChanges.set(owning(MECHANIC, 3), ENGINEER, 3))
        .isEqualTo(Result.ok(owning(MECHANIC, 3, ENGINEER, 3)));
  }

  @Test
  void aSecondaryMayNotPassThePrimary() {
    assertThat(AdminChanges.set(owning(MECHANIC, 3, ENGINEER, 1), ENGINEER, 4))
        .isEqualTo(Result.err(new AdminProblem.AbovePrimary(ENGINEER, 4, MECHANIC, 3)));
    assertThat(AdminChanges.set(owning(MECHANIC, 3), GOVERNOR, 4))
        .isEqualTo(Result.err(new AdminProblem.AbovePrimary(GOVERNOR, 4, MECHANIC, 3)));
  }

  @Test
  void thePrimaryMayNotDropBelowASecondary() {
    assertThat(AdminChanges.set(owning(MECHANIC, 3, ENGINEER, 1, GOVERNOR, 2), MECHANIC, 1))
        .isEqualTo(Result.err(new AdminProblem.BelowSecondary(MECHANIC, 1, GOVERNOR, 2)));
    assertThat(AdminChanges.set(owning(MECHANIC, 3, ENGINEER, 2), MECHANIC, 2))
        .isEqualTo(Result.ok(owning(MECHANIC, 2, ENGINEER, 2)));
  }

  @Test
  void thePrimaryMayBeRaised() {
    assertThat(AdminChanges.set(owning(MECHANIC, 3, ENGINEER, 3), MECHANIC, 5))
        .isEqualTo(Result.ok(owning(MECHANIC, 5, ENGINEER, 3)));
  }

  @Test
  void removingThePrimaryWithSecondariesWouldChangeIt() {
    assertThat(AdminChanges.set(owning(MECHANIC, 3, ENGINEER, 1), MECHANIC, 0))
        .isEqualTo(Result.err(new AdminProblem.WouldChangePrimary(MECHANIC)));
  }

  @Test
  void removingALonePrimaryLeavesANewPlayer() {
    assertThat(AdminChanges.set(owning(MECHANIC, 3), MECHANIC, 0))
        .isEqualTo(Result.ok(TrackProgress.empty()));
  }

  @Test
  void removingASecondaryMovesLaterTracksUp() {
    var result = AdminChanges.set(owning(MECHANIC, 3, ENGINEER, 1, GOVERNOR, 2), ENGINEER, 0);

    assertThat(result).isEqualTo(Result.ok(owning(MECHANIC, 3, GOVERNOR, 2)));
  }

  @Test
  void settingTheSameLevelIsAllowedEvenWhenItWouldNotBe() {
    var progress = owning(MECHANIC, 3, ENGINEER, 3);

    assertThat(AdminChanges.set(progress, ENGINEER, 3)).isEqualTo(Result.ok(progress));
  }

  @Test
  void theCooldownIsKept() {
    var progress = boughtAt(owning(MECHANIC, 1), NOW);

    assertThat(AdminChanges.set(progress, MECHANIC, 4))
        .isEqualTo(Result.ok(boughtAt(owning(MECHANIC, 4), NOW)));
  }

  @ParameterizedTest
  @EnumSource(Track.class)
  void resetClearsLevelsPrimaryAndCooldown(Track track) {
    var reset = AdminChanges.reset();

    assertThat(reset).isEqualTo(TrackProgress.empty());
    assertThat(reset.level(track)).isZero();
    assertThat(reset.primary()).isEmpty();
    assertThat(reset.lastPurchase()).isEmpty();
  }

  @Test
  void afterAResetAnyTrackCanBecomePrimary() {
    var reset = AdminChanges.reset();

    assertThat(AdminChanges.set(reset, GOVERNOR, 2)).isEqualTo(Result.ok(owning(GOVERNOR, 2)));
  }

  @Test
  void levelsOutsideTheRangeAreABug() {
    assertThatThrownBy(() -> AdminChanges.set(TrackProgress.empty(), MECHANIC, 6))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> AdminChanges.set(TrackProgress.empty(), MECHANIC, -1))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
