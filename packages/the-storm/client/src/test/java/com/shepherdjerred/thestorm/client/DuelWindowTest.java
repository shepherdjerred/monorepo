package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.client.wire.DuelMarker;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class DuelWindowTest {
  private static final UUID MATCH = UUID.fromString("11111111-2222-4333-8444-555555555555");

  @Test
  void EarlyTerminalIsAnOriginalFrameFollowedOnlyByExplicitHolds() {
    var window = sampled(20);
    window.complete();
    var receipt = window.receipt();
    assertThat(receipt.terminalFrame()).isEqualTo(30);
    assertThat(receipt.clock().complete()).isTrue();
    assertThat(receipt.startedElapsedNanos()).isEqualTo(1000);
    assertThat(receipt.bindings()).hasSize(900);
    assertThat(receipt.bindings().subList(0, 30))
        .allSatisfy(binding -> assertThat(binding.sourceFrame()).isEqualTo(binding.index()));
    assertThat(receipt.bindings().subList(30, 900))
        .allSatisfy(
            binding -> {
              assertThat(binding.sourceFrame()).isEqualTo(30);
              assertThat(binding.marker().result()).isEqualTo("loss");
            });
  }

  @Test
  void FullWindowStopsAtTick599WithoutInventingAFullMatchOutcome() {
    var window = sampled(-1);
    window.complete();
    var receipt = window.receipt();
    assertThat(receipt.terminalFrame()).isEqualTo(-1);
    assertThat(receipt.clock().complete()).isFalse();
    assertThat(receipt.clock().entries()).hasSize(601);
    assertThat(receipt.bindings().getLast().marker().elapsed()).isEqualTo(599);
  }

  @Test
  void LateFirstFrameInterruptedDuelAndMissingTicksInvalidateTheWindow() {
    var late = window();
    late.accept(marker("begin", -1, "waiting"), 1000);
    late.accept(marker("tick", 0, "live"), 2000);
    late.accept(marker("tick", 1, "live"), 50002000);
    assertThatThrownBy(() -> late.bind(0, 50002001, 31)).hasMessageContaining("first live render");
    var cancelled = window();
    cancelled.accept(marker("begin", -1, "waiting"), 1000);
    assertThatThrownBy(() -> cancelled.accept(marker("terminal", -1, "cancelled"), 1001))
        .isInstanceOf(IllegalStateException.class);
    var missing = window();
    missing.accept(marker("begin", -1, "waiting"), 1000);
    missing.accept(marker("tick", 0, "live"), 2000);
    assertThatThrownBy(() -> missing.accept(marker("tick", 2, "live"), 100002000))
        .hasMessageContaining("missing");
  }

  @Test
  void SlowServerCannotTurnAShortNativeWindowIntoACompletedClip() {
    var window = window();
    window.accept(marker("begin", -1, "waiting"), 1000);
    window.accept(marker("tick", 0, "live"), 2000);
    for (int i = 0; i < 900; i++) window.bind(i, 2000 + i * FrameClock.SECOND / FrameClock.FPS, i);
    assertThatThrownBy(window::complete).hasMessageContaining("did not reach");
  }

  private static DuelWindow sampled(int ending) {
    var window = window();
    window.accept(marker("begin", -1, "waiting"), 1000);
    int next = 0;
    boolean ended = false;
    for (int i = 0; i < 900; i++) {
      long now = 2000 + i * FrameClock.SECOND / FrameClock.FPS;
      while (!ended && next < 600 && 2000 + next * 50000000L <= now) {
        window.accept(marker("tick", next, "live"), 2000 + next * 50000000L);
        if (next == ending) {
          window.accept(marker("terminal", next, "loss"), 2000 + next * 50000000L);
          ended = true;
        }
        next++;
      }
      window.bind(i, now, i);
    }
    return window;
  }

  private static DuelWindow window() {
    return new DuelWindow(new DuelTimeline.Expected(17, "red", "authored", "basic"), 1000);
  }

  @Test
  void PaperFrameClockStaysAuthoritativeWhenTheSampledClientClockMovesBackwards() {
    var window = window();
    window.accept(marker("begin", -1, "waiting"), 1000);
    window.accept(marker("tick", 0, "live"), 2000);
    var first = window.bind(0, 2000, 42);
    window.accept(marker("tick", 1, "live"), 50002000);
    var next = window.bind(1, 50002000, 41);
    var camera =
        new VideoCapture.Camera(java.util.List.of(31.5, 74.62, 22.5), 180, 35, 70, false, false);
    var rendered = new VideoFrames.Frame(1, 50000000, 41, camera);

    assertThat(next.clientWorldTick()).isLessThan(first.clientWorldTick());
    assertThat(next.paperFrame(rendered)).isEqualTo(new VideoFrames.Frame(1, 50000000, 31, camera));
    assertThat(next.marker().worldTick()).isGreaterThan(first.marker().worldTick());
    assertThatThrownBy(() -> next.paperFrame(new VideoFrames.Frame(1, 50000000, 32, camera)))
        .hasMessageContaining("sampled client clock");
  }

  private static DuelMarker marker(String kind, int elapsed, String result) {
    return new DuelMarker(
        MATCH,
        17,
        "red",
        "authored",
        "basic",
        kind.equals("begin") ? 0 : elapsed + (kind.equals("tick") ? 1 : 2),
        kind,
        elapsed < 0 ? -1 : 80 + elapsed,
        30 + Math.max(0, elapsed),
        elapsed,
        result);
  }
}
