package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.util.Arrays;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DocsContractTest {
  @Test
  void recordsAgreeWithTheNeutralDocsContract() throws IOException {
    try (var source =
        java.util.Objects.requireNonNull(
            getClass().getResourceAsStream("/storm-docs-video.json"))) {
      var contract = Protocol.JSON.readTree(source);
      assertThat(contract.required("version").intValue()).isEqualTo(4);
      assertThat(contract.required("fps").intValue()).isEqualTo(FrameClock.FPS);
      for (var entry :
          Map.of(
                  "receipt",
                  VideoFrames.DocsReceipt.class,
                  "written",
                  VideoFrames.DocsWritten.class,
                  "observation",
                  VideoFrames.DocsObservation.class,
                  "marker",
                  DocsCapture.Marker.class)
              .entrySet()) {
        var fields =
            Arrays.stream(entry.getValue().getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName)
                .toList();
        assertThat(Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(fields))
            .isEqualTo(contract.required(entry.getKey()));
      }
      var receipt =
          new VideoFrames.DocsReceipt(
              4,
              "mc-docs-frames",
              "minecraft-framebuffer",
              FrameClock.FPS,
              1,
              true,
              "",
              java.util.List.of(),
              java.util.List.of());
      var json = Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(receipt);
      assertThat(json.required("kind")).isEqualTo(contract.required("kind"));
      assertThat(json.required("source")).isEqualTo(contract.required("source"));
    }
  }
}
