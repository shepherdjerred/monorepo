package com.shepherdjerred.mcbridge.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;

class TextAndNamesTest {
  @Test
  void stripsAnsiAndLegacyFormatting() {
    assertThat(PlainText.strip("\u001B[32mDone\u001B[0m §aok§r")).isEqualTo("Done ok");
  }

  @Test
  void messageLogSeparatesErrorsAndClears() {
    MessageLog log = new MessageLog();
    log.message("§a5 blocks changed");
    log.error("Unknown block");

    assertThat(log.messages()).containsExactly("5 blocks changed");
    assertThat(log.errors()).containsExactly("Unknown block");

    log.clear();
    assertThat(log.messages()).isEmpty();
    assertThat(log.errors()).isEmpty();
  }

  @Test
  void validatesSessionNames() {
    assertThat(new SessionName("build-1").actorName()).isEqualTo("agent:build-1");
    assertThatThrownBy(() -> new SessionName("Build")).isInstanceOf(BridgeException.class);
    assertThatThrownBy(() -> new SessionName("")).isInstanceOf(BridgeException.class);
    assertThatThrownBy(() -> new SessionName("a".repeat(33))).isInstanceOf(BridgeException.class);
  }

  @Test
  void validatesWorldEditOps() {
    WeOp op = new WeOp("//set stone", new BlockPos(0, 0, 0), new BlockPos(1, 1, 1), null);
    assertThat(op.commandName()).isEqualTo("/set");
    assertThat(new WeOp("//undo", null, null, null).commandName()).isEqualTo("/undo");
    assertThatThrownBy(() -> new WeOp("/set stone", null, null, null))
        .isInstanceOf(BridgeException.class);
    assertThatThrownBy(
            () -> new WeOp("//sphere glass 3", new BlockPos(0, 0, 0), null, new BlockPos(1, 1, 1)))
        .isInstanceOf(BridgeException.class);
  }

  @Test
  void validatesRotations() {
    assertThat(new Rotation(270).degrees()).isEqualTo(270);
    assertThatThrownBy(() -> new Rotation(45)).isInstanceOf(BridgeException.class);
  }

  @Test
  void mintsFileSafeSnapshotIds() {
    SnapshotId id =
        SnapshotId.next(Instant.ofEpochMilli(1_000_000), RandomGenerator.of("L64X128MixRandom"));

    assertThat(id.value()).matches("snap-lfls-[0-9a-f]{6}");
    assertThatThrownBy(() -> new SnapshotId("../etc"))
        .isInstanceOfSatisfying(
            BridgeException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.NOT_FOUND));
  }
}
