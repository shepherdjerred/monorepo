package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;

import io.netty.buffer.Unpooled;
import java.util.HexFormat;
import net.minecraft.core.RegistryAccess;
import net.minecraft.network.RegistryFriendlyByteBuf;
import org.junit.jupiter.api.Test;

final class RecordedControlsTest {
  @Test
  void releasedClicksSurviveOneSampleAndHeldButtonsRemainHeld() {
    var pulses = new RecordedControls.Pulses();
    pulses.attack();
    pulses.use();
    assertThat(pulses.drain(false, false)).isEqualTo(3);
    assertThat(pulses.drain(false, false)).isZero();
    assertThat(pulses.drain(true, false)).isEqualTo(1);
    assertThat(pulses.drain(true, false)).isEqualTo(1);
    assertThat(pulses.drain(false, true)).isEqualTo(2);
    assertThat(pulses.drain(false, false)).isZero();
  }

  @Test
  void wireBytesMatchThePaperDecoder() {
    var buffer = new RegistryFriendlyByteBuf(Unpooled.buffer(), RegistryAccess.EMPTY);
    try {
      var packet = new RecordedControls.Packet(42, 65, 26950, -1225, 3, 6, false, -1);
      RecordedControls.Packet.CODEC.encode(buffer, packet);
      var bytes = new byte[buffer.readableBytes()];
      buffer.getBytes(0, bytes);
      assertThat(HexFormat.of().formatHex(bytes))
          .isEqualTo("01000000000000002a4100006946fffffb37030600ffffffffffffffff");
      assertThat(RecordedControls.Packet.CODEC.decode(buffer)).isEqualTo(packet);
    } finally {
      buffer.release();
    }
  }
}
