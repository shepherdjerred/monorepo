package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.record.ControlPacket;
import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import java.nio.ByteBuffer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class InputsRecordingTest {
  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void manualReadinessNeverConsumesOrInventsAnInputSample() {
    var server = MockBukkit.mock();
    var player = server.addPlayer();
    var inputs = new Inputs();
    assertThat(inputs.recordingStatus(player)).anyMatch(text -> text.contains("not received"));
    assertThat(inputs.frame(0, "p1", player, 0).source()).isEqualTo(InputFrame.Source.MISSING);
    inputs.onPluginMessageReceived(ControlPacket.CHANNEL, player, packet(false));
    assertThat(inputs.recordingStatus(player))
        .anyMatch(text -> text.contains("manual"))
        .anyMatch(text -> text.contains("waiting for combat observations"));
    assertThat(inputs.frame(0, "p1", player, 0).source()).isEqualTo(InputFrame.Source.HUMAN);
    assertThat(inputs.frame(0, "p1", player, 0).source()).isEqualTo(InputFrame.Source.MISSING);
  }

  @Test
  void readinessPreservesAutomatedProvenance() {
    var server = MockBukkit.mock();
    var player = server.addPlayer();
    var inputs = new Inputs();
    inputs.onPluginMessageReceived(ControlPacket.CHANNEL, player, packet(true));
    assertThat(inputs.recordingStatus(player)).anyMatch(text -> text.contains("automated"));
    assertThat(inputs.frame(0, "p1", player, 0).source()).isEqualTo(InputFrame.Source.AUTOMATED);
  }

  private static byte[] packet(boolean automated) {
    return ByteBuffer.allocate(ControlPacket.BYTES)
        .put((byte) 1)
        .putLong(0)
        .put((byte) InputFrame.FORWARD)
        .putInt(0)
        .putInt(0)
        .put((byte) 1)
        .put((byte) 1)
        .put(automated ? (byte) 1 : (byte) 0)
        .putLong(-1)
        .array();
  }
}
