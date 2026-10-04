package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ProtocolTest {
  @Test
  void SharedFixturesRejectContractDrift() throws IOException {
    var fixtures = Protocol.JSON.readTree(Files.readString(Path.of("protocol-fixtures.json")));
    for (var valid : fixtures.required("valid")) {
      assertThat(Protocol.read(valid.toString()).version()).isEqualTo(1);
    }
    for (var invalid : fixtures.required("invalid")) {
      assertThatThrownBy(() -> Protocol.read(invalid.toString()))
          .isInstanceOf(RuntimeException.class);
    }
  }

  @Test
  void RejectsOversizedFramesAndNonfiniteAngles() {
    assertThatThrownBy(() -> Protocol.read("x".repeat(Protocol.MAX_FRAME + 1)))
        .isInstanceOf(IllegalArgumentException.class);
    var node = Protocol.JSON.readTree("{\"yaw\":1e100}");
    assertThatThrownBy(() -> Protocol.angle(node, "yaw", -360, 360))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
