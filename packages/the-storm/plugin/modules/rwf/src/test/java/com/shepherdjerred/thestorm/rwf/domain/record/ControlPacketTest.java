package com.shepherdjerred.thestorm.rwf.domain.record;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.HexFormat;
import org.junit.jupiter.api.Test;

final class ControlPacketTest {
  /** Same bytes are pinned by the Fabric encoder test. */
  private static byte[] human() {
    return HexFormat.of().parseHex("01000000000000002a4100006946fffffb37030600ffffffffffffffff");
  }

  @Test
  void decodesTheClientWireContractWithoutInventingLabels() {
    var packet = ControlPacket.decode(human());
    assertThat(packet).isEqualTo(new ControlPacket(42, 65, 26950, -1225, 3, 6, false, -1));
    var frame = packet.frame(20, "p1");
    assertThat(frame.attack()).isTrue();
    assertThat(frame.use()).isTrue();
    assertThat(frame.source()).isEqualTo(InputFrame.Source.HUMAN);
    assertThat(frame.sequence()).isEqualTo(42);
  }

  @Test
  void rejectsUnknownVersionsMalformedSizeAndUnknownSource() {
    assertThatThrownBy(() -> ControlPacket.decode(new byte[20]))
        .isInstanceOf(IllegalArgumentException.class);
    var version = human();
    version[0] = 2;
    assertThatThrownBy(() -> ControlPacket.decode(version))
        .isInstanceOf(IllegalArgumentException.class);
    var source = human();
    source[20] = 2;
    assertThatThrownBy(() -> ControlPacket.decode(source))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
