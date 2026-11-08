package com.shepherdjerred.thestorm.mechanics.domain.ic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class WirelessBandsTest {
  @Test
  void theMostRecentTransmissionWinsAndTheReceiverSamplesOnRisingEdges() {
    var bands = new WirelessBands<String>();
    assertThat(bands.receive("gate", false, true, source -> true)).contains(false);
    assertThat(bands.transmit("gate", "a", true)).isTrue();
    assertThat(bands.receive("gate", false, true, source -> true)).contains(true);
    assertThat(bands.receive("gate", true, true, source -> true)).isEmpty();
    assertThat(bands.receive("gate", true, false, source -> true)).isEmpty();
    assertThat(bands.transmit("other", "b", true)).isTrue();
    assertThat(bands.transmit("gate", "a", false)).isFalse();
    assertThat(bands.receive("gate", false, true, source -> true)).contains(false);
    assertThat(bands.receive("other", false, true, source -> true)).contains(true);
  }

  @Test
  void selfTriggeredReceiverTracksBandChangesWithoutAnInputEdge() {
    var bands = new WirelessBands<String>();
    assertThat(bands.receiveSelfTriggered("light1", source -> true)).contains(false);
    bands.transmit("light1", "a", true);
    assertThat(bands.receiveSelfTriggered("light1", source -> true)).contains(true);
    bands.transmit("light2", "b", false);
    assertThat(bands.receiveSelfTriggered("light1", source -> true)).contains(true);
    bands.transmit("light1", "a", false);
    assertThat(bands.receiveSelfTriggered("light1", source -> true)).contains(false);
  }

  @Test
  void anUnpermittedSenderCannotDriveOrSuppressTheLastPermittedTransmission() {
    var bands = new WirelessBands<String>();
    bands.transmit("door", "owner", true);
    bands.transmit("door", "outsider", false);
    assertThat(bands.receiveSelfTriggered("door", "owner"::equals)).contains(true);
    assertThat(bands.receiveSelfTriggered("door", "outsider"::equals)).contains(false);
    assertThat(bands.receiveSelfTriggered("door", source -> false)).contains(false);
    bands.forget("owner");
    assertThat(bands.receiveSelfTriggered("door", "owner"::equals)).contains(false);
    bands.transmit("door", "owner", true);
    bands.transmit("new-band", "owner", true);
    assertThat(bands.receiveSelfTriggered("door", "owner"::equals)).contains(false);
  }

  @Test
  void unnamedBandsAreRejected() {
    var bands = new WirelessBands<String>();
    assertThatThrownBy(() -> bands.transmit(" ", "a", true))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> bands.receive("", false, true, source -> true))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> bands.receiveSelfTriggered(" ", source -> true))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
