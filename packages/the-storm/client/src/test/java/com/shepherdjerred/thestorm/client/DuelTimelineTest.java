package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.client.wire.DuelMarker;
import java.io.IOException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class DuelTimelineTest {
  private static final UUID MATCH = UUID.fromString("11111111-2222-4333-8444-555555555555");

  @Test
  void codecAndReceiptsAgreeWithTheNeutralContractAndGoldenBytes() throws IOException {
    try (var source =
        java.util.Objects.requireNonNull(
            getClass().getResourceAsStream("/storm-duel-clock.json"))) {
      var spec = Protocol.JSON.readTree(source);
      assertThat(spec.required("version").intValue()).isEqualTo(DuelMarker.VERSION);
      assertThat(spec.required("channel").stringValue()).isEqualTo(DuelMarker.CHANNEL);
      assertThat(spec.required("bytes").intValue()).isEqualTo(DuelMarker.BYTES);
      assertThat(spec.required("byteOrder").stringValue()).isEqualTo("big-endian");
      assertThat(spec.required("maximumElapsed").intValue()).isEqualTo(DuelMarker.MAXIMUM_ELAPSED);
      for (var pair :
          java.util.Map.of(
                  "sides",
                  DuelMarker.SIDES,
                  "modes",
                  DuelMarker.MODES,
                  "opponents",
                  DuelMarker.OPPONENTS,
                  "markers",
                  DuelMarker.MARKERS,
                  "results",
                  DuelMarker.RESULTS)
              .entrySet())
        assertThat(Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(pair.getValue()))
            .isEqualTo(spec.required(pair.getKey()));
      for (var pair :
          java.util.Map.of(
                  "packet",
                  DuelMarker.class,
                  "expected",
                  DuelTimeline.Expected.class,
                  "entry",
                  DuelTimeline.Entry.class,
                  "receipt",
                  DuelTimeline.Receipt.class,
                  "status",
                  DuelCapture.Status.class)
              .entrySet())
        assertThat(
                Protocol.JSON.<tools.jackson.databind.JsonNode>valueToTree(names(pair.getValue())))
            .isEqualTo(spec.required(pair.getKey()));
      var bytes = HexFormat.of().parseHex(spec.required("golden").required("hex").stringValue());
      var decoded = DuelMarker.decode(bytes);
      assertThat(decoded.encode()).isEqualTo(bytes);
      assertThat(decoded)
          .isEqualTo(
              Protocol.JSON.treeToValue(
                  spec.required("golden").required("packet"), DuelMarker.class));
      assertThatThrownBy(() -> DuelMarker.decode(Arrays.copyOf(bytes, bytes.length + 1)))
          .isInstanceOf(IllegalArgumentException.class);
      bytes[0] = 2;
      assertThatThrownBy(() -> DuelMarker.decode(bytes))
          .isInstanceOf(IllegalArgumentException.class);
      bytes[0] = 1;
      bytes[25] = (byte) 255;
      assertThatThrownBy(() -> DuelMarker.decode(bytes))
          .isInstanceOf(IllegalArgumentException.class);
    }
  }

  @Test
  void terminalMayOccurDuringTheFirstTickWithoutASecondTick() {
    var timeline = timeline();
    timeline.accept(marker("begin", -1, "waiting"), 100);
    timeline.accept(marker("tick", 0, "live"), 150);
    timeline.accept(marker("terminal", 0, "loss"), 150);
    assertThat(timeline.receipt().complete()).isTrue();
    assertThat(timeline.receipt().entries()).hasSize(3);
    assertThat(timeline.receipt().entries().getLast().marker().elapsed()).isZero();
    timeline.accept(marker("terminal", 0, "loss"), 151);
    assertThat(timeline.state()).isEqualTo("FAILED");
  }

  @Test
  void fullNativeWindowIsBoundedAndContiguousThroughTheTimeout() {
    var timeline = timeline();
    timeline.accept(marker("begin", -1, "waiting"), 100);
    for (int tick = 0; tick <= DuelMarker.MAXIMUM_ELAPSED; tick++)
      timeline.accept(marker("tick", tick, "live"), 150 + tick * 50000000L);
    timeline.accept(marker("terminal", 1200, "timeout"), 60000000150L);
    assertThat(timeline.state()).isEqualTo("TERMINAL");
    assertThat(timeline.count()).isEqualTo(1203);
    assertThatThrownBy(() -> marker("tick", 1201, "live"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void missingDuplicateStaleIdentityAndReversedClocksFailWithoutProducingCompleteEvidence() {
    for (var bad :
        List.of(
            marker("tick", 1, "live"),
            marker("begin", -1, "waiting"),
            new DuelMarker(
                UUID.randomUUID(), 17, "red", "authored", "basic", 1, "tick", 80, 30, 0, "live"),
            new DuelMarker(MATCH, 18, "red", "authored", "basic", 1, "tick", 80, 30, 0, "live"))) {
      var timeline = timeline();
      timeline.accept(marker("begin", -1, "waiting"), 100);
      timeline.accept(bad, 101);
      assertThat(timeline.state()).isEqualTo("FAILED");
      assertThat(timeline.receipt().complete()).isFalse();
      assertThat(timeline.receipt().error()).isNotEmpty();
    }
    var timeline = timeline();
    timeline.accept(marker("begin", -1, "waiting"), 100);
    timeline.accept(marker("tick", 0, "live"), 99);
    assertThat(timeline.error()).contains("backwards");
  }

  @Test
  void tickGapsAndTerminalClockChangesCannotBeSealedAsACompletedRun() {
    var timeline = timeline();
    timeline.accept(marker("begin", -1, "waiting"), 100);
    timeline.accept(marker("tick", 0, "live"), 150);
    timeline.accept(
        new DuelMarker(MATCH, 17, "red", "authored", "basic", 2, "tick", 83, 31, 1, "live"), 200);
    assertThat(timeline.error()).contains("continuous");
    var terminal = timeline();
    terminal.accept(marker("begin", -1, "waiting"), 100);
    terminal.accept(marker("tick", 0, "live"), 150);
    terminal.accept(
        new DuelMarker(MATCH, 17, "red", "authored", "basic", 2, "terminal", 81, 31, 0, "win"),
        151);
    assertThat(terminal.error()).contains("terminal clock");
  }

  @Test
  void cancellingCountdownIsRecordedButDoesNotInventLiveTicks() {
    var timeline = timeline();
    timeline.accept(marker("begin", -1, "waiting"), 100);
    timeline.accept(marker("terminal", -1, "cancelled"), 101);
    assertThat(timeline.receipt().complete()).isTrue();
    assertThat(timeline.receipt().entries()).hasSize(2);
  }

  private static DuelTimeline timeline() {
    return new DuelTimeline(new DuelTimeline.Expected(17, "red", "authored", "basic"), 100);
  }

  private static DuelMarker marker(String marker, int elapsed, String result) {
    int sequence = marker.equals("begin") ? 0 : elapsed + (marker.equals("tick") ? 1 : 2);
    return new DuelMarker(
        MATCH,
        17,
        "red",
        "authored",
        "basic",
        sequence,
        marker,
        elapsed < 0 ? -1 : 80 + elapsed,
        30 + Math.max(0, elapsed),
        elapsed,
        result);
  }

  private static List<String> names(Class<?> recordType) {
    return Arrays.stream(recordType.getRecordComponents())
        .map(java.lang.reflect.RecordComponent::getName)
        .toList();
  }
}
