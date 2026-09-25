package com.shepherdjerred.thestorm.tracks.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.tracks.app.Track;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class TrackIdsTest {

  @ParameterizedTest
  @EnumSource(Track.class)
  void everyIdParsesInAnyCase(Track track) {
    assertThat(TrackIds.parse(track.id())).contains(track);
    assertThat(TrackIds.parse(track.name())).contains(track);
  }

  @Test
  void unknownIdsDoNotParse() {
    assertThat(TrackIds.parse("wizard")).isEmpty();
    assertThat(TrackIds.parse("")).isEmpty();
  }

  @Test
  void allListsTheIdsInOrder() {
    assertThat(TrackIds.all())
        .containsExactly("shopkeeper", "mechanic", "engineer", "spellcaster", "governor");
  }
}
