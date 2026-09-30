package com.shepherdjerred.thestorm.tracks.domain;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.GOVERNOR;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.app.Track.SHOPKEEPER;
import static com.shepherdjerred.thestorm.tracks.app.Track.SPELLCASTER;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class TrackProgressTest {

  @ParameterizedTest
  @EnumSource(Track.class)
  void anEmptyPlayerIsUntrainedEverywhere(Track track) {
    var empty = TrackProgress.empty();

    assertThat(empty.level(track)).isZero();
    assertThat(empty.isPrimary(track)).isFalse();
    assertThat(empty.position(track)).isZero();
    assertThat(empty.primary()).isEmpty();
    assertThat(empty.lastPurchase()).isEmpty();
  }

  @Test
  void theFirstTrackBoughtIsThePrimary() {
    var progress = TrackProgress.empty().purchased(ENGINEER, 1, NOW);

    assertThat(progress.primary()).contains(new TrackLevel(ENGINEER, 1));
    assertThat(progress.isPrimary(ENGINEER)).isTrue();
    assertThat(progress.isPrimary(MECHANIC)).isFalse();
  }

  @Test
  void laterTracksDoNotReplaceThePrimary() {
    var progress =
        TrackProgress.empty()
            .purchased(ENGINEER, 1, NOW)
            .purchased(MECHANIC, 1, NOW)
            .purchased(ENGINEER, 2, NOW)
            .purchased(MECHANIC, 2, NOW);

    assertThat(progress.primary()).contains(new TrackLevel(ENGINEER, 2));
    assertThat(progress.owned())
        .containsExactly(new TrackLevel(ENGINEER, 2), new TrackLevel(MECHANIC, 2));
  }

  @Test
  void positionsFollowFirstPurchaseOrder() {
    var progress = owning(GOVERNOR, 3, SHOPKEEPER, 1, MECHANIC, 2);

    assertThat(progress.position(GOVERNOR)).isZero();
    assertThat(progress.position(SHOPKEEPER)).isEqualTo(1);
    assertThat(progress.position(MECHANIC)).isEqualTo(2);
    assertThat(progress.position(ENGINEER)).isEqualTo(3);
    assertThat(progress.position(SPELLCASTER)).isEqualTo(3);
  }

  @Test
  void raisingALevelKeepsItsPlaceInTheOrder() {
    var progress = owning(GOVERNOR, 3, SHOPKEEPER, 1, MECHANIC, 2).withLevel(SHOPKEEPER, 3);

    assertThat(progress.owned())
        .containsExactly(
            new TrackLevel(GOVERNOR, 3),
            new TrackLevel(SHOPKEEPER, 3),
            new TrackLevel(MECHANIC, 2));
  }

  @Test
  void settingZeroRemovesATrackAndLaterTracksMoveUp() {
    var progress = owning(GOVERNOR, 3, SHOPKEEPER, 1, MECHANIC, 2).withLevel(SHOPKEEPER, 0);

    assertThat(progress.level(SHOPKEEPER)).isZero();
    assertThat(progress.position(MECHANIC)).isEqualTo(1);
  }

  @Test
  void purchasingRecordsTheTime() {
    var progress = owning(MECHANIC, 1).purchased(MECHANIC, 2, NOW);

    assertThat(progress.lastPurchase()).contains(NOW);
  }

  @Test
  void settingALevelKeepsTheLastPurchase() {
    var progress = Progressions.boughtAt(owning(MECHANIC, 1), NOW).withLevel(MECHANIC, 4);

    assertThat(progress.lastPurchase()).contains(NOW);
  }

  @Test
  void aSecondaryAboveThePrimaryIsImpossible() {
    assertThatThrownBy(() -> owning(MECHANIC, 2, ENGINEER, 3))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("above primary");
    assertThatThrownBy(() -> owning(MECHANIC, 2).withLevel(ENGINEER, 3))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> owning(MECHANIC, 2, ENGINEER, 2).withLevel(MECHANIC, 1))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aTrackCannotBeOwnedTwice() {
    assertThatThrownBy(
            () ->
                new TrackProgress(
                    List.of(new TrackLevel(MECHANIC, 1), new TrackLevel(MECHANIC, 1)),
                    Optional.empty()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("owned twice");
  }

  @Test
  void levelsOutsideTheRangeAreRejected() {
    assertThatThrownBy(() -> new TrackLevel(MECHANIC, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TrackLevel(MECHANIC, 6))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> TrackProgress.empty().withLevel(MECHANIC, -1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> TrackProgress.empty().withLevel(MECHANIC, 6))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void ownedTracksAreCopied() {
    var owned = new java.util.ArrayList<TrackLevel>(List.of(new TrackLevel(MECHANIC, 1)));
    var progress = new TrackProgress(owned, Optional.empty());

    owned.add(new TrackLevel(ENGINEER, 1));

    assertThat(progress.owned()).hasSize(1);
  }
}
