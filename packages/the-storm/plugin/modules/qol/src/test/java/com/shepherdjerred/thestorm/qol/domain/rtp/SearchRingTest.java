package com.shepherdjerred.thestorm.qol.domain.rtp;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class SearchRingTest {

  @Test
  void settledLandPastTheBorderLeavesNoRingBeyondIt() {
    var room = BorderRoom.maxRadius(new BlockPoint(68, 66), new BlockPoint(0, 0), 6000, 128);
    assertThat(SearchRing.around(3200, 512, 1500, room)).isEmpty();
  }

  @Test
  void aWholeBorderSearchStillHasRoomOnAClampedMap() {
    var room = BorderRoom.maxRadius(new BlockPoint(68, 66), new BlockPoint(0, 0), 6000, 128);
    assertThat(SearchRing.within(256, room)).contains(new SearchRing(256, room));
  }

  @Test
  void aWholeBorderSearchIsEmptyWhenTheBorderIsInsideItsInnerRadius() {
    assertThat(SearchRing.within(256, 200)).isEmpty();
  }

  @Test
  void frontierKeepsItsRingPastSettlements() {
    var room = BorderRoom.maxRadius(new BlockPoint(0, 0), new BlockPoint(0, 0), 7000, 128);
    assertThat(room).isEqualTo(3372);
    assertThat(SearchRing.around(0, 512, 1500, room)).contains(new SearchRing(512, 2012));
  }
}
