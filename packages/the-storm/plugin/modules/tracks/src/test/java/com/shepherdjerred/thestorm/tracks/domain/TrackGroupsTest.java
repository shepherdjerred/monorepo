package com.shepherdjerred.thestorm.tracks.domain;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.HashSet;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class TrackGroupsTest {

  @Test
  void groupsAreNamedByTrackAndLevel() {
    assertThat(TrackGroups.name(MECHANIC, 3)).isEqualTo("storm-mechanic-3");
  }

  @Test
  void everyTrackHasOneGroupPerLevelChainedByInheritance() {
    var definitions = TrackGroups.definitions();

    assertThat(definitions).hasSize(Track.values().length * Track.MAX_LEVEL);
    assertThat(definitions)
        .contains(
            new TrackGroups.Definition(
                "storm-mechanic-1", "thestorm.track.mechanic.1", Optional.empty()),
            new TrackGroups.Definition(
                "storm-mechanic-2", "thestorm.track.mechanic.2", Optional.of("storm-mechanic-1")),
            new TrackGroups.Definition(
                "storm-governor-5", "thestorm.track.governor.5", Optional.of("storm-governor-4")));
  }

  @Test
  void parentsAreDeclaredBeforeTheirChildren() {
    var declared = new HashSet<String>();
    for (var definition : TrackGroups.definitions()) {
      definition.parent().ifPresent(parent -> assertThat(declared).contains(parent));
      declared.add(definition.name());
    }
  }

  @Test
  void aPlayerBelongsToTheGroupForEachOwnedLevel() {
    assertThat(TrackGroups.memberships(owning(MECHANIC, 3, ENGINEER, 1)))
        .containsExactlyInAnyOrder("storm-mechanic-3", "storm-engineer-1");
    assertThat(TrackGroups.memberships(TrackProgress.empty())).isEmpty();
  }

  @Test
  void onlyThisModulesGroupsAreRecognised() {
    for (var definition : TrackGroups.definitions()) {
      assertThat(TrackGroups.isTrackGroup(definition.name())).isTrue();
    }
    assertThat(TrackGroups.isTrackGroup("default")).isFalse();
    assertThat(TrackGroups.isTrackGroup("storm-staff")).isFalse();
    assertThat(TrackGroups.isTrackGroup("storm-mechanic-6")).isFalse();
    assertThat(TrackGroups.isTrackGroup("storm-mechanic-0")).isFalse();
    assertThat(TrackGroups.isTrackGroup("storm-wizard-1")).isFalse();
    assertThat(TrackGroups.isTrackGroup("storm-mechanic-1-old")).isFalse();
    assertThat(TrackGroups.isTrackGroup("xstorm-mechanic-1")).isFalse();
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 6})
  void levelsOutsideTheRangeHaveNoGroup(int level) {
    assertThatThrownBy(() -> TrackGroups.name(MECHANIC, level))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
