package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.util.Arrays;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class FramePacingContractTest {
  @Test
  void javaRecordsBoundsAndProducerInventoryMatchTheNeutralContract() throws IOException {
    try (var input =
        java.util.Objects.requireNonNull(
            getClass().getResourceAsStream("/storm-frame-pacing.json"))) {
      var wire = Protocol.JSON.readTree(input);
      assertThat(wire.required("maximumDurationMs").intValue())
          .isEqualTo(FramePacingClock.MAX_DURATION_MS);
      assertThat(wire.required("maximumFrames").intValue()).isEqualTo(FramePacingClock.MAX_FRAMES);
      assertThat(
              Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(
                  FramePacing.CODE_RESOURCES))
          .isEqualTo(wire.required("codeResources"));
      for (var entry :
          Map.of(
                  "receipt",
                  FramePacing.Receipt.class,
                  "status",
                  FramePacing.Status.class,
                  "settings",
                  FramePacing.Settings.class,
                  "runtime",
                  FramePacing.RendererRuntime.class,
                  "observation",
                  FramePacingClock.Observation.class,
                  "quantiles",
                  FramePacingClock.Quantiles.class,
                  "code",
                  FramePacing.Code.class,
                  "camera",
                  FramePacingClock.Camera.class)
              .entrySet()) {
        var names =
            Arrays.stream(entry.getValue().getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName)
                .toList();
        assertThat(Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(names))
            .isEqualTo(wire.required(entry.getKey()));
      }
    }
  }
}
