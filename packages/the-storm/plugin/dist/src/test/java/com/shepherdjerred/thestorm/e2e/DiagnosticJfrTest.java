package com.shepherdjerred.thestorm.e2e;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import jdk.jfr.Event;
import jdk.jfr.FlightRecorder;
import jdk.jfr.FlightRecorderListener;
import jdk.jfr.Name;
import jdk.jfr.Recording;
import jdk.jfr.RecordingState;
import jdk.jfr.StackTrace;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class DiagnosticJfrTest {
  @TempDir Path directory;

  private static final String XML =
      """
      <configuration version="2.0" label="fixture" description="fixture" provider="test">
        <event name="storm.FixtureJfrControllerTest"><setting name="enabled">true</setting></event>
        <event name="jdk.ObjectCount"><setting name="enabled">true</setting></event>
      </configuration>
      """;

  @Name("storm.FixtureJfrControllerTest")
  @StackTrace(false)
  static final class Marker extends Event {}

  private final DiagnosticJfr.Binding binding =
      new DiagnosticJfr.Binding(UUID.randomUUID(), UUID.randomUUID());

  @Test
  void requiresPostStartLiveValidationAndDeadWorkerForCompletedReadableExport() throws Exception {
    try (var controller = controller()) {
      controller.start(binding);
      await(controller, status -> status.state() == DiagnosticJfr.State.PREPARED);
      controller.observeLive(binding.match(), true);
      var unvalidated =
          await(controller, status -> status.state() == DiagnosticJfr.State.VALIDATING);
      assertFalse(unvalidated.liveValidated());
      controller.observeLive(binding.match(), true);
      new Marker().commit();
      controller.stop(binding);
      var complete = terminal(controller);

      assertEquals(DiagnosticJfr.State.COMPLETE, complete.state());
      assertFalse(complete.workerAlive());
      assertTrue(complete.liveValidated());
      assertEquals("", complete.failure());
      assertNotNull(complete.detail().export());
      assertTrue(complete.detail().export().bytes() > 0);
      assertTrue(
          complete.detail().export().eventTypes().containsKey("storm.FixtureJfrControllerTest"));
      assertEquals(64, complete.detail().export().sha256().length());
      assertEquals("false", complete.detail().settings().get("jdk.ObjectCount#enabled"));
      assertEquals("true", complete.detail().settings().get("storm.BotThink#enabled"));
      assertEquals(
          PosixFilePermissions.fromString("rw-------"),
          Files.getPosixFilePermissions(root().resolve(complete.detail().relativeFile())));
      assertEquals(
          XML, Files.readString(root().resolve(binding.attempt().toString()).resolve("paper.jfc")));
      assertThrows(IllegalStateException.class, () -> controller.start(binding));
      assertOwnedRecordingClosed(complete);
    }
  }

  @Test
  void rejectsForeignBindingWithoutStoppingOwnedCapture() throws Exception {
    try (var controller = controller()) {
      activate(controller);
      var other = new DiagnosticJfr.Binding(binding.match(), UUID.randomUUID());
      assertThrows(IllegalArgumentException.class, () -> controller.stop(other));
      assertThrows(IllegalArgumentException.class, () -> controller.status(other));
      assertEquals(DiagnosticJfr.State.RECORDING, controller.status().state());
      controller.stop(binding);
      assertEquals(DiagnosticJfr.State.COMPLETE, terminal(controller).state());
    }
  }

  @Test
  void invalidatesChangedBindingBeforeActivationAndNeverRegressesTerminalState() throws Exception {
    try (var controller = controller()) {
      controller.start(binding);
      await(controller, status -> status.state() == DiagnosticJfr.State.PREPARED);
      controller.observeLive(UUID.randomUUID(), true);
      var failed = terminal(controller);
      assertEquals(DiagnosticJfr.State.FAILED, failed.state());
      for (var index = 0; index < 1000; index++) controller.observeLive(binding.match(), true);
      assertEquals(DiagnosticJfr.State.FAILED, controller.status().state());
      assertThrows(IllegalStateException.class, () -> controller.stop(binding));
      assertEquals(DiagnosticJfr.State.FAILED, controller.status().state());
    }
  }

  @Test
  void changedBindingAfterActualStartExportsButCannotComplete() throws Exception {
    try (var controller = controller()) {
      controller.start(binding);
      await(controller, status -> status.state() == DiagnosticJfr.State.PREPARED);
      controller.observeLive(binding.match(), true);
      await(controller, status -> status.state() == DiagnosticJfr.State.VALIDATING);
      controller.noLiveMatch();
      assertThrows(IllegalStateException.class, () -> controller.stop(binding));
      var failed = terminal(controller);
      assertEquals(DiagnosticJfr.State.FAILED, failed.state());
      assertFalse(failed.liveValidated());
      assertNotNull(failed.detail().export());
      assertTrue(failed.failure().contains("no longer Live"));
      assertOwnedRecordingClosed(failed);
    }
  }

  @Test
  void liveObservationsCannotOverwriteExportOrTerminalTransitions() throws Exception {
    try (var controller = controller()) {
      activate(controller);
      controller.stop(binding);
      for (var index = 0; index < 10000; index++) controller.observeLive(binding.match(), true);
      var complete = terminal(controller);
      assertEquals(DiagnosticJfr.State.COMPLETE, complete.state());
      for (var index = 0; index < 1000; index++) controller.observeLive(binding.match(), true);
      assertEquals(DiagnosticJfr.State.COMPLETE, controller.status().state());
    }
  }

  @Test
  void foreignRunningRecordingIsRejectedAndNeverStopped() throws Exception {
    try (var other = new Recording(Map.of());
        var controller = controller()) {
      other.start();
      controller.start(binding);
      var failed = terminal(controller);
      assertEquals(DiagnosticJfr.State.FAILED, failed.state());
      assertTrue(failed.foreignRecordingObserved());
      assertEquals(RecordingState.RUNNING, other.getState());
    }
  }

  @Test
  void foreignDelayedRecordingIsRejectedAndNeverStopped() throws Exception {
    try (var other = new Recording(Map.of());
        var controller = controller()) {
      other.scheduleStart(Duration.ofMinutes(1));
      controller.start(binding);
      assertTrue(terminal(controller).foreignRecordingObserved());
      assertEquals(RecordingState.DELAYED, other.getState());
    }
  }

  @Test
  void laterForeignStartTaintsAndExportsOwnedRecordingWithoutStoppingForeignOne() throws Exception {
    try (var controller = controller();
        var other = new Recording(Map.of())) {
      activate(controller);
      other.start();
      var failed = terminal(controller);
      assertEquals(DiagnosticJfr.State.FAILED, failed.state());
      assertTrue(failed.foreignRecordingObserved());
      assertNotNull(failed.detail().export());
      assertEquals(RecordingState.RUNNING, other.getState());
      assertOwnedRecordingClosed(failed);
    }
  }

  @Test
  void laterForeignDelayedRecordingInvalidatesEvenWithoutRunning() throws Exception {
    try (var controller = controller();
        var other = new Recording(Map.of())) {
      activate(controller);
      other.scheduleStart(Duration.ofMinutes(1));
      var failed = terminal(controller);
      assertEquals(DiagnosticJfr.State.FAILED, failed.state());
      assertTrue(failed.foreignRecordingObserved());
      assertNotNull(failed.detail().export());
      assertEquals(RecordingState.DELAYED, other.getState());
    }
  }

  @Test
  void shutdownIsNonblockingAndIncompleteWhileWorkerIsStillPreparing() throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var caller = Thread.currentThread();
    var controller =
        new DiagnosticJfr(
            root(),
            () -> {
              assertFalse(caller.equals(Thread.currentThread()));
              assertEquals(
                  ClassLoader.getPlatformClassLoader(),
                  Thread.currentThread().getContextClassLoader());
              entered.countDown();
              assertTrue(release.await(5, TimeUnit.SECONDS));
              return settings();
            },
            limits());
    try (controller) {
      controller.start(binding);
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      controller.close();
      controller.close();
      assertTrue(controller.status().workerAlive());
      assertTrue(controller.status().failure().contains("plugin disabled"));
    } finally {
      release.countDown();
    }
    assertEquals(DiagnosticJfr.State.FAILED, terminal(controller).state());
  }

  @Test
  void unusedShutdownIsIdempotentAndCreatesNoWorkerOrFiles() {
    var controller = controller();
    controller.close();
    controller.close();
    assertFalse(controller.status().workerAlive());
    assertFalse(Files.exists(root()));
    assertThrows(IllegalStateException.class, () -> controller.start(binding));
  }

  @Test
  void activeShutdownExportsIncompleteAndTerminatesWorker() throws Exception {
    var controller = controller();
    activate(controller);
    controller.close();
    controller.close();
    var failed = terminal(controller);
    assertEquals(DiagnosticJfr.State.FAILED, failed.state());
    assertTrue(failed.failure().contains("plugin disabled"));
    assertNotNull(failed.detail().export());
    assertOwnedRecordingClosed(failed);
  }

  @Test
  void configurationFailureIsTerminalAndCreatesNoOutput() throws Exception {
    try (var controller =
        new DiagnosticJfr(
            root(),
            () -> {
              throw new IOException("synthetic settings failure");
            },
            limits())) {
      controller.start(binding);
      var failed = terminal(controller);
      assertEquals(DiagnosticJfr.State.FAILED, failed.state());
      assertTrue(failed.failure().contains("synthetic settings failure"));
      assertFalse(Files.exists(root()));
    }
  }

  @Test
  void exclusiveAttemptDirectoryCannotBeReused() throws Exception {
    Files.createDirectory(
        root(), PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
    Files.createDirectory(root().resolve(binding.attempt().toString()));
    try (var controller = controller()) {
      controller.start(binding);
      assertEquals(DiagnosticJfr.State.FAILED, terminal(controller).state());
    }
  }

  @Test
  void exportFailureCannotBecomeComplete() throws Exception {
    try (var controller = controller()) {
      activate(controller);
      var destination = root().resolve(controller.status().detail().relativeFile());
      Files.delete(destination);
      Files.createDirectory(destination);
      controller.stop(binding);
      var failed = terminal(controller);
      assertEquals(DiagnosticJfr.State.FAILED, failed.state());
      assertTrue(failed.failure().contains("did not close"));
      assertOwnedRecordingClosed(failed);
    }
  }

  @Test
  void durationExpiryExportsButNeverBecomesExplicitCompletion() throws Exception {
    try (var controller =
        new DiagnosticJfr(
            root(),
            DiagnosticJfrTest::settings,
            new DiagnosticJfr.Limits(
                Duration.ofMillis(500), 8 * 1024 * 1024, Duration.ofSeconds(5)))) {
      activate(controller);
      var failed = terminal(controller);
      assertEquals(DiagnosticJfr.State.FAILED, failed.state());
      assertNotNull(failed.detail().export());
      assertTrue(failed.failure().contains("without validated explicit stop"));
    }
  }

  @Test
  void durationExpiryWaitsForNativeDestinationCloseBeforeInspectingExport() throws Exception {
    var stopping = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var listener =
        new FlightRecorderListener() {
          @Override
          public void recordingStateChanged(Recording recording) {
            if (!recording.getName().equals("storm-fixture-" + binding.attempt())
                || recording.getState() != RecordingState.STOPPED) return;
            stopping.countDown();
            try {
              release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException failure) {
              Thread.currentThread().interrupt();
            }
          }
        };
    FlightRecorder.addListener(listener);
    try (var controller =
        new DiagnosticJfr(
            root(),
            DiagnosticJfrTest::settings,
            new DiagnosticJfr.Limits(
                Duration.ofMillis(500), 8 * 1024 * 1024, Duration.ofSeconds(5)))) {
      activate(controller);
      assertTrue(stopping.await(5, TimeUnit.SECONDS));
      var exporting =
          await(
              controller,
              status -> status.state() == DiagnosticJfr.State.EXPORTING || !status.workerAlive());
      assertEquals(DiagnosticJfr.State.EXPORTING, exporting.state());
      assertTrue(exporting.workerAlive());
      release.countDown();
      var failed = terminal(controller);
      assertEquals(DiagnosticJfr.State.FAILED, failed.state());
      assertNotNull(failed.detail().export());
      assertTrue(failed.failure().contains("without validated explicit stop"));
      assertOwnedRecordingClosed(failed);
    } finally {
      release.countDown();
      FlightRecorder.removeListener(listener);
    }
  }

  @Test
  void errorDuringPostExportCleanupCannotBecomeComplete() throws Exception {
    try (var controller =
        new DiagnosticJfr(
            root(),
            DiagnosticJfrTest::settings,
            limits(),
            listener -> {
              FlightRecorder.removeListener(listener);
              throw new AssertionError("synthetic post-export cleanup failure");
            })) {
      activate(controller);
      controller.stop(binding);
      var failed = terminal(controller);
      assertEquals(DiagnosticJfr.State.FAILED, failed.state());
      assertTrue(failed.failure().contains("synthetic post-export cleanup failure"));
      assertNotNull(failed.detail().export());
      assertOwnedRecordingClosed(failed);
    }
  }

  private DiagnosticJfr controller() {
    return new DiagnosticJfr(root(), DiagnosticJfrTest::settings, limits());
  }

  private static DiagnosticJfr.Limits limits() {
    return new DiagnosticJfr.Limits(Duration.ofSeconds(10), 8 * 1024 * 1024, Duration.ofSeconds(5));
  }

  private Path root() {
    return directory.resolve("jfr");
  }

  private static DiagnosticJfrSettings.Settings settings() throws Exception {
    var bytes = XML.getBytes(StandardCharsets.UTF_8);
    return DiagnosticJfrSettings.parse(
        new ByteArrayInputStream(bytes), DiagnosticJfrSettings.sha256(bytes));
  }

  private void activate(DiagnosticJfr controller) throws Exception {
    controller.start(binding);
    await(controller, status -> status.state() == DiagnosticJfr.State.PREPARED);
    controller.observeLive(binding.match(), true);
    await(controller, status -> status.state() == DiagnosticJfr.State.VALIDATING);
    controller.observeLive(binding.match(), true);
    assertEquals(DiagnosticJfr.State.RECORDING, controller.status().state());
  }

  private static DiagnosticJfr.Status terminal(DiagnosticJfr controller) throws Exception {
    return await(controller, status -> !status.workerAlive());
  }

  private static DiagnosticJfr.Status await(
      DiagnosticJfr controller, Predicate<DiagnosticJfr.Status> condition) throws Exception {
    var deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
    DiagnosticJfr.Status status;
    do {
      status = controller.status();
      if (condition.test(status)) return status;
      Thread.sleep(2);
    } while (System.nanoTime() < deadline);
    throw new AssertionError("JFR state deadline: " + status);
  }

  private static void assertOwnedRecordingClosed(DiagnosticJfr.Status status) {
    assertTrue(
        FlightRecorder.getFlightRecorder().getRecordings().stream()
            .noneMatch(recording -> recording.getId() == status.detail().recordingId()));
  }
}
