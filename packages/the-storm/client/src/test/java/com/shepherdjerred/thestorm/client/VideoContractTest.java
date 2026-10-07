package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.util.Arrays;
import java.util.Set;
import org.junit.jupiter.api.Test;

class VideoContractTest {
  @Test
  void JavaRecordsAndBoundsAgreeWithTheNeutralCaptureContract() throws IOException {
    try (var source =
        java.util.Objects.requireNonNull(getClass().getResourceAsStream("/storm-video.json"))) {
      var spec = Protocol.JSON.readTree(source);
      Protocol.keys(
          spec,
          Set.of(
              "version",
              "video",
              "source",
              "cameraTolerance",
              "status",
              "kind",
              "receipt",
              "written",
              "frame",
              "camera"));
      assertThat(spec.required("version").intValue()).isEqualTo(1);
      assertThat(spec.required("video").required("fps").intValue()).isEqualTo(FrameClock.FPS);
      assertThat(spec.required("video").required("width").intValue()).isEqualTo(1280);
      assertThat(spec.required("video").required("height").intValue()).isEqualTo(720);
      assertThat(spec.required("video").required("maximumFrames").intValue()).isEqualTo(1800);
      assertThat(spec.required("video").required("pendingImages").intValue()).isEqualTo(8);
      assertThat(spec.required("source").stringValue()).isEqualTo("minecraft-framebuffer");
      assertThat(spec.required("kind").stringValue()).isEqualTo("rwf-rendered-frames");
      assertThat(spec.required("cameraTolerance").required("position").doubleValue())
          .isEqualTo(VideoCapture.Camera.POSITION_EPSILON);
      assertThat(spec.required("cameraTolerance").required("degrees").doubleValue())
          .isEqualTo(VideoCapture.Camera.ANGLE_EPSILON);
      assertThat(
              Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(
                  names(VideoFrames.Receipt.class)))
          .isEqualTo(spec.required("receipt"));
      assertThat(
              Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(
                  names(VideoCapture.Status.class)))
          .isEqualTo(spec.required("status"));
      assertThat(
              Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(
                  names(VideoCapture.Camera.class)))
          .isEqualTo(spec.required("camera"));
      assertThat(
              Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(
                  names(VideoFrames.Frame.class)))
          .isEqualTo(spec.required("frame"));
      assertThat(
              Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(
                  names(VideoFrames.Written.class)))
          .isEqualTo(spec.required("written"));
    }
  }

  private static java.util.List<String> names(Class<?> recordType) {
    return Arrays.stream(recordType.getRecordComponents())
        .map(java.lang.reflect.RecordComponent::getName)
        .toList();
  }

  @Test
  void NativeWindowRecordsAgreeWithTheNeutralContract() throws IOException {
    try (var source =
        java.util.Objects.requireNonNull(
            getClass().getResourceAsStream("/storm-duel-video.json"))) {
      var spec = Protocol.JSON.readTree(source);
      assertThat(spec.required("version").intValue()).isEqualTo(3);
      assertThat(spec.required("worldTickSource").stringValue())
          .isEqualTo("latest-received-paper-marker");
      assertThat(spec.required("kind").stringValue()).isEqualTo("rwf-rendered-duel-frames");
      assertThat(spec.required("liveTicks").intValue()).isEqualTo(DuelWindow.LIVE_TICKS);
      assertThat(spec.required("frames").intValue()).isEqualTo(DuelWindow.FRAMES);
      assertThat(spec.required("window").stringValue()).isEqualTo(DuelWindow.WINDOW);
      for (var pair :
          java.util.Map.of(
                  "receipt",
                  VideoFrames.DuelReceipt.class,
                  "duel",
                  DuelWindow.Receipt.class,
                  "binding",
                  DuelWindow.Binding.class)
              .entrySet())
        assertThat(
                Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(names(pair.getValue())))
            .isEqualTo(spec.required(pair.getKey()));
    }
  }
}
