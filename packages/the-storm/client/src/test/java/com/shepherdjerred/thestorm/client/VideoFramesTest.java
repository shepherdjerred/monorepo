package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class VideoFramesTest {
  private static final VideoCapture.Camera CAMERA =
      new VideoCapture.Camera(List.of(0.0, 65.0, 0.0), 0, 0, 70, false, false);

  @Test
  void parallelEncodersPersistLaterFramesFirstButSealAnOrderedLosslessInventory(@TempDir Path dir)
      throws Exception {
    try (var encoders = VideoFrames.encoders()) {
      var writer = prepared(dir, encoders);
      var first = new Pixels(0xff123456, true, false);
      var second = new Pixels(0x7fabcdef, false, false);
      submit(writer, first, 0);
      assertThat(first.entered.await(5, TimeUnit.SECONDS)).isTrue();
      submit(writer, second, 1);
      try {
        assertThat(second.closed.await(5, TimeUnit.SECONDS)).isTrue();
        assertThat(first.closed.getCount()).isOne();
        assertThat(writer.drained()).isFalse();
      } finally {
        first.release.countDown();
      }
      drained(writer);
      var receipt = receipt(writer, 2);
      assertThat(receipt.complete()).isTrue();
      assertThat(receipt.error()).isEmpty();
      assertThat(receipt.frames()).extracting(saved -> saved.frame().index()).containsExactly(0, 1);
      var saved = receipt.frames().get(1);
      var decoded = ImageIO.read(dir.resolve("frames").resolve(saved.file()).toFile());
      assertThat(decoded.getRGB(0, 0)).isEqualTo(0x7fabcdef);
      assertThat(first.closed.getCount()).isZero();
    }
  }

  @Test
  void onlyEightImagesAreAdmittedAndFailedEncodingClosesItsImageAndDrains(@TempDir Path dir)
      throws Exception {
    try (var encoders = VideoFrames.encoders()) {
      var writer = prepared(dir, encoders);
      var first = new Pixels(0xff123456, true, false);
      var second = new Pixels(0xffabcdef, true, true);
      submit(writer, first, 0);
      submit(writer, second, 1);
      assertThat(first.entered.await(5, TimeUnit.SECONDS)).isTrue();
      assertThat(second.entered.await(5, TimeUnit.SECONDS)).isTrue();
      try {
        for (var index = 2; index < 8; index++)
          submit(writer, new Pixels(0xff123456, false, false), index);
        assertThatThrownBy(writer::reserve).hasMessage("Frame writer is overloaded");
      } finally {
        first.release.countDown();
        second.release.countDown();
      }
      drained(writer);
      assertThat(second.closed.getCount()).isZero();
      assertThat(writer.failure()).contains("deliberate pixel failure");
      var receipt = receipt(writer, 8);
      assertThat(receipt.complete()).isFalse();
      assertThat(receipt.frames())
          .extracting(saved -> saved.frame().index())
          .containsExactly(0, 2, 3, 4, 5, 6, 7);
    }
  }

  @Test
  void terminalHoldsWaitForPersistenceAndKeepExactPixelsWithParallelCompletion(@TempDir Path dir)
      throws Exception {
    try (var encoders = VideoFrames.encoders()) {
      var writer = prepared(dir, encoders);
      var terminal = new Pixels(0xff123456, true, false);
      writer.reserve();
      writer.write(terminal, frame(0), true);
      assertThat(terminal.entered.await(5, TimeUnit.SECONDS)).isTrue();
      writer.reserve();
      writer.hold(frame(1), 0);
      var later = new Pixels(0xffabcdef, false, false);
      submit(writer, later, 2);
      try {
        assertThat(later.closed.await(5, TimeUnit.SECONDS)).isTrue();
        assertThat(writer.drained()).isFalse();
      } finally {
        terminal.release.countDown();
      }
      drained(writer);
      var receipt = receipt(writer, 3);
      assertThat(receipt.complete()).isTrue();
      assertThat(receipt.frames())
          .extracting(saved -> saved.frame().index())
          .containsExactly(0, 1, 2);
      assertThat(receipt.frames().get(0).sha256()).isEqualTo(receipt.frames().get(1).sha256());
    }
  }

  @Test
  void failedTerminalReleasesItsDependentHoldWithoutPublishingInventedPixels(@TempDir Path dir)
      throws Exception {
    try (var encoders = VideoFrames.encoders()) {
      var writer = prepared(dir, encoders);
      var terminal = new Pixels(0xff123456, false, true);
      writer.reserve();
      writer.write(terminal, frame(0), true);
      writer.reserve();
      writer.hold(frame(1), 0);
      drained(writer);
      var receipt = receipt(writer, 2);
      assertThat(receipt.complete()).isFalse();
      assertThat(receipt.frames()).isEmpty();
      assertThat(writer.failure()).contains("deliberate pixel failure");
      assertThat(terminal.closed.getCount()).isZero();
    }
  }

  @Test
  void rejectedSubmissionClosesTheImageAndReturnsItsPermit(@TempDir Path dir) throws Exception {
    try (var encoders = VideoFrames.encoders()) {
      var writer = prepared(dir, encoders);
      encoders.shutdown();
      var image = new Pixels(0xff123456, false, false);
      submit(writer, image, 0);
      assertThat(image.closed.getCount()).isZero();
      assertThat(writer.failure()).contains("RejectedExecutionException");
      assertThat(writer.drained()).isTrue();
    }
  }

  private static VideoFrames prepared(Path dir, java.util.concurrent.ExecutorService encoders)
      throws Exception {
    var writer = new VideoFrames(dir.resolve("frames"), encoders);
    writer.prepare().get(5, TimeUnit.SECONDS);
    return writer;
  }

  private static void submit(VideoFrames writer, Pixels image, int index) {
    writer.reserve();
    writer.write(image, frame(index), false);
  }

  private static VideoFrames.Frame frame(int index) {
    return new VideoFrames.Frame(index, index * 1_000_000_000L / 30, index, CAMERA);
  }

  private static VideoFrames.Receipt receipt(VideoFrames writer, int count) throws Exception {
    var file = writer.finish(count, writer.failure(), null).get(5, TimeUnit.SECONDS);
    return Protocol.JSON.readValue(Files.readString(file), VideoFrames.Receipt.class);
  }

  private static void drained(VideoFrames writer) throws InterruptedException {
    var end = System.nanoTime() + Duration.ofSeconds(5).toNanos();
    while (!writer.drained() && System.nanoTime() < end) Thread.sleep(5);
    assertThat(writer.drained()).isTrue();
  }

  private static final class Pixels implements VideoFrames.Image {
    final CountDownLatch entered = new CountDownLatch(1);
    final CountDownLatch release;
    final CountDownLatch closed = new CountDownLatch(1);
    private final int color;
    private final boolean broken;

    Pixels(int color, boolean blocked, boolean broken) {
      this.color = color;
      this.broken = broken;
      release = new CountDownLatch(blocked ? 1 : 0);
    }

    @Override
    public int width() {
      return 1280;
    }

    @Override
    public int height() {
      return 720;
    }

    @Override
    public int[] pixels() {
      entered.countDown();
      try {
        if (!release.await(5, TimeUnit.SECONDS))
          throw new IllegalStateException("test release timed out");
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException(interrupted);
      }
      if (broken) throw new IllegalStateException("deliberate pixel failure");
      var pixels = new int[1280 * 720];
      Arrays.fill(pixels, color);
      return pixels;
    }

    @Override
    public void close() {
      closed.countDown();
    }
  }
}
