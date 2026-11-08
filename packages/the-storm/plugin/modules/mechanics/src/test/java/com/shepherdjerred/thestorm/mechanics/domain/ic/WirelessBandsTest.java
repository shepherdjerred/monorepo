package com.shepherdjerred.thestorm.mechanics.domain.ic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class WirelessBandsTest {
  @Test
  void theMostRecentTransmissionWinsAndTheReceiverSamplesOnRisingEdges() {
    var bands = new WirelessBands();
    assertThat(bands.receive("gate", false, true)).contains(false);
    assertThat(bands.transmit("gate", true)).isTrue();
    assertThat(bands.receive("gate", false, true)).contains(true);
    assertThat(bands.receive("gate", true, true)).isEmpty();
    assertThat(bands.receive("gate", true, false)).isEmpty();
    assertThat(bands.transmit("other", true)).isTrue();
    assertThat(bands.transmit("gate", false)).isFalse();
    assertThat(bands.receive("gate", false, true)).contains(false);
    assertThat(bands.receive("other", false, true)).contains(true);
  }

  @Test
  void selfTriggeredReceiverTracksBandChangesWithoutAnInputEdge() {
    var bands = new WirelessBands();
    assertThat(bands.receiveSelfTriggered("light1")).contains(false);
    bands.transmit("light1", true);
    assertThat(bands.receiveSelfTriggered("light1")).contains(true);
    bands.transmit("light2", false);
    assertThat(bands.receiveSelfTriggered("light1")).contains(true);
    bands.transmit("light1", false);
    assertThat(bands.receiveSelfTriggered("light1")).contains(false);
  }

  @Test
  void unnamedBandsAreRejected() {
    var bands = new WirelessBands();
    assertThatThrownBy(() -> bands.transmit(" ", true))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> bands.receive("", false, true))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> bands.receiveSelfTriggered(" "))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
